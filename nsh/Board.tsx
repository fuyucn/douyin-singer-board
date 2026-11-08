import { Clipboard, effect, mount, Scroll, signal, Storage, Text, View } from "nsh";
import { Button, DataTable, Input, type DataTableColumn } from "nsh/base";
import Client from "./listener-bundle.js";
import { Matcher } from "./src/matcher";
import { DEFAULT_SING_PREFIX, type Config, type DanmuInfo } from "./src/types";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const columns: DataTableColumn[] = [
  { key: "idx", title: "#", width: 40, align: "end" },
  { key: "user", title: "用户", width: 140 },
  { key: "song", title: "歌曲", width: 220 },
  { key: "medal", title: "粉丝团", width: 90 },
  { key: "time", title: "时间", width: 80 },
];

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function Board() {
  const config = signal<Config>({
    room_id: "145997388006",
    sing_prefix: DEFAULT_SING_PREFIX,
    fans_level: 0,
    sing_cd: 0,
    cooldown_seconds: 1800,
    max_songs_per_user: 3,
    target_playlist_name: "",
    target_playlist_id: 0,
    kugou_enabled: false,
  });
  const status = signal("未连接");
  const roomName = signal("");
  const songs = signal<DanmuInfo[]>([]);
  const logs = signal<string[]>([]);
  const manual = signal("");

  const matcher = new Matcher(config());
  effect(() => matcher.reload(config()));

  let configLoaded = false;
  Storage.getItem("board.config")
    .then((raw) => {
      if (raw) {
        try { config.set({ ...config(), ...JSON.parse(raw) }); } catch {}
      }
    })
    .catch(() => {})
    .finally(() => { configLoaded = true; });
  effect(() => {
    if (!configLoaded) return;
    Storage.setItem("board.config", JSON.stringify(config())).catch(() => {});
  });

  let client: any = null;
  let generation = 0;

  const log = (line: string) => {
    const t = clock(Math.floor(Date.now() / 1000));
    logs.update((v) => [...v.slice(-120), `${t} ${line}`]);
  };

  const patch = (p: Partial<Config>) => config.update((c) => ({ ...c, ...p }));
  const num = (value: string, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const rows = () =>
    songs().map((s, i) => ({
      idx: String(i + 1),
      user: s.uname || "?",
      song: s.song_name,
      medal: s.medal_level > 0 ? `${s.medal_name} ${s.medal_level}` : "—",
      time: clock(s.send_time),
    }));

  const addSong = (danmu: DanmuInfo) => {
    if (songs().some((s) => s.song_name === danmu.song_name)) {
      log(`重复跳过: ${danmu.song_name}`);
      return;
    }
    const max = config().max_songs_per_user;
    if (max > 0 && danmu.uid !== "manual") {
      const count = songs().filter((s) => s.uid === danmu.uid).length;
      if (count >= max) {
        log(`超过每人上限: ${danmu.uname} (${count}/${max})`);
        return;
      }
    }
    songs.update((v) => [danmu, ...v]);
    log(`✅ ${danmu.uname}: ${danmu.song_name}`);
  };

  const onChat = (msg: any) => {
    const user = msg?.user ?? {};
    const badge = user?.BadgeImageList?.[0]?.content ?? {};
    const level = parseInt(String(badge?.level ?? "0"), 10) || 0;
    const result = matcher.match({
      uid: String(user.id ?? ""),
      uname: String(user.nickName ?? ""),
      content: String(msg?.content ?? ""),
      medal_level: level,
      medal_name: String(badge?.alternativeText ?? ""),
    });
    if (result.kind === "song") addSong(result.danmu);
    else if (result.kind === "cancel") {
      const uid = result.uid;
      songs.update((v) => v.filter((s) => s.uid !== uid));
      log("↩️ 取消点歌");
    } else {
      log(`❌ ${user.nickName ?? "?"}: ${result.reason}`);
    }
  };

  const stop = () => {
    generation += 1;
    if (client) { try { client.close(); } catch {} client = null; }
    status.set("未连接");
  };

  const start = async () => {
    const rid = config().room_id.trim();
    if (!/^\d{6,}$/.test(rid)) { status.set("房间号只能填数字"); return; }
    stop();
    const gen = (generation += 1);
    status.set("解析房间...");
    log(`连接房间 ${rid}`);
    try {
      const html = await (await fetch(`https://live.douyin.com/${rid}`, { headers: { "User-Agent": UA } })).text();
      if (gen !== generation) return;
      const ids = [...html.matchAll(/roomId\\":\\"([^"\\]+)/g)]
        .map((m) => m[1])
        .filter((v) => /^\d{15,}$/.test(v));
      const roomId = ids[0] ?? rid;
      const nick = html.match(/nickname\\":\\"([^"\\]+)/)?.[1];
      if (nick && nick !== "$undefined") roomName.set(nick);
      status.set("连接中...");
      const c: any = new Client(roomId, { autoReconnect: 0, autoStart: false });
      client = c;
      c.on("open", () => { status.set("已连接"); log("弹幕连接已建立"); });
      c.on("close", () => { status.set("已断开"); log("弹幕连接断开"); });
      c.on("error", (e: any) => log("error " + String(e?.message ?? e)));
      c.on("decoded", (ev: any) => {
        if (ev?.method === "WebcastChatMessage" && ev?.data) onChat(ev.data);
      });
      await c.connect();
      if (gen === generation) log("connect() returned");
    } catch (e: any) {
      status.set("失败");
      log("FAIL " + String(e?.message ?? e));
    }
  };

  const addManual = () => {
    const name = manual().trim();
    if (!name) return;
    addSong({
      msg_id: `manual_${Date.now()}`,
      uid: "manual",
      uname: "主播",
      song_name: name,
      raw_msg: name,
      medal_level: 0,
      medal_name: "",
      send_time: Math.floor(Date.now() / 1000),
    });
    manual.set("");
  };

  const simulate = () => {
    const r = matcher.match({
      uid: "test",
      uname: "测试观众",
      content: `点歌 ${manual().trim() || "晴天"}`,
      medal_level: 0,
      medal_name: "",
    });
    if (r.kind === "song") addSong(r.danmu);
    else log(`模拟未匹配: ${r.reason}`);
  };

  const copyAll = () => {
    Clipboard.writeText(songs().map((s) => s.song_name).join("\n"));
    log(`已复制 ${songs().length} 首`);
  };

  return (
    <View class="flex-1 bg-[#f4f6f8]">
      <View class="h-[52px] flex-row items-center gap-3 border-b border-[#e3e7ec] bg-white px-4">
        <Text class="text-sm font-semibold text-[#191d24]">SUSUSongBoard</Text>
        <Text class="text-[11px] text-[#88919f]">NSH 迁移版</Text>
        <View class={`h-2 w-2 rounded-full ${status() === "已连接" ? "bg-[#2e8a66]" : "bg-[#c2c8d0]"}`} />
        <Text class="text-xs text-[#59616e]">{status()}</Text>
        <Text class="text-xs text-[#88919f]">{roomName()}</Text>
        <View class="flex-1" />
        <Text class="text-[11px] text-[#88919f]">0.1.0</Text>
      </View>

      <View class="flex-1 flex-row">
        <View class="w-[280px] gap-3 border-r border-[#e3e7ec] bg-white p-4">
          <Text class="text-[13px] font-semibold text-[#191d24]">连接</Text>
          <View class="gap-2">
            <Text class="text-[12px] text-[#59616e]">抖音房间号</Text>
            <Input
              value={config().room_id}
              onChange={({ value }) => patch({ room_id: value })}
              onSubmit={start}
              placeholder="例如 145997388006"
              class="rounded-[6px] border border-[#d7dce2] px-3 py-2 text-[13px] text-[#191d24]"
            />
            <View class="flex-row gap-2">
              <Button onPress={start} class="flex-1 rounded-[6px] bg-[#2f6fb0] px-3 py-2 active:opacity-80">
                <Text class="text-[13px] text-white">连接</Text>
              </Button>
              <Button onPress={stop} class="rounded-[6px] border border-[#d7dce2] px-3 py-2 active:bg-[#f4f6f8]">
                <Text class="text-[13px] text-[#191d24]">断开</Text>
              </Button>
            </View>
            <Text class="text-[11px] text-[#88919f]">状态：{status()}</Text>
          </View>

          <View class="h-px bg-[#e3e7ec]" />
          <Text class="text-[13px] font-semibold text-[#191d24]">点歌规则</Text>
          <View class="gap-2">
            <Text class="text-[12px] text-[#59616e]">点歌模板</Text>
            <Input
              value={config().sing_prefix}
              onChange={({ value }) => patch({ sing_prefix: value })}
              class="rounded-[6px] border border-[#d7dce2] px-3 py-2 text-[13px] text-[#191d24]"
            />
            <View class="flex-row items-center gap-2">
              <Text class="text-[12px] text-[#59616e]">粉丝团最低</Text>
              <Input
                value={String(config().fans_level)}
                onChange={({ value }) => patch({ fans_level: num(value) })}
                class="w-16 rounded-[6px] border border-[#d7dce2] px-2 py-1 text-[13px] text-[#191d24]"
              />
            </View>
            <View class="flex-row items-center gap-2">
              <Text class="text-[12px] text-[#59616e]">点歌冷却(秒)</Text>
              <Input
                value={String(config().sing_cd)}
                onChange={({ value }) => patch({ sing_cd: num(value) })}
                class="w-16 rounded-[6px] border border-[#d7dce2] px-2 py-1 text-[13px] text-[#191d24]"
              />
            </View>
            <View class="flex-row items-center gap-2">
              <Text class="text-[12px] text-[#59616e]">每人上限</Text>
              <Input
                value={String(config().max_songs_per_user)}
                onChange={({ value }) => patch({ max_songs_per_user: num(value) })}
                class="w-16 rounded-[6px] border border-[#d7dce2] px-2 py-1 text-[13px] text-[#191d24]"
              />
            </View>
          </View>

          <View class="h-px bg-[#e3e7ec]" />
          <Text class="text-[13px] font-semibold text-[#191d24]">本次会话</Text>
          <View class="gap-1">
            <Text class="text-[12px] text-[#59616e]">已点歌曲：{songs().length}</Text>
            <Text class="text-[12px] text-[#59616e]">连接：{status()}</Text>
          </View>
        </View>

        <View class="flex-1 p-3 gap-2">
          <View class="flex-row items-center gap-2">
            <Text class="text-[13px] font-semibold text-[#191d24]">点歌列表</Text>
            <Text class="text-[11px] text-[#88919f]">{songs().length} 首</Text>
            <View class="flex-1" />
            <Input
              value={manual()}
              onChange={({ value }) => manual.set(value)}
              onSubmit={addManual}
              placeholder="手动添加歌曲"
              class="w-40 rounded-[6px] border border-[#d7dce2] px-2 py-1 text-[12px] text-[#191d24]"
            />
            <Button onPress={addManual} class="rounded-[6px] bg-[#2f6fb0] px-3 py-1 active:opacity-80">
              <Text class="text-[12px] text-white">添加</Text>
            </Button>
            <Button onPress={simulate} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
              <Text class="text-[12px] text-[#191d24]">模拟点歌</Text>
            </Button>
            <Button onPress={copyAll} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
              <Text class="text-[12px] text-[#191d24]">复制全部</Text>
            </Button>
            <Button onPress={() => songs.set([])} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
              <Text class="text-[12px] text-[#191d24]">清空</Text>
            </Button>
          </View>

          <View class="flex-1 rounded-[8px] border border-[#e3e7ec] bg-white">
            <DataTable
              columns={columns}
              data={rows()}
              rowHeight={40}
              class="flex-1"
              empty={<Text class="text-[12px] text-[#88919f]">还没有点歌，连接直播间等待弹幕…</Text>}
              classes={{
                header: "bg-[#f0f2f5]",
                headerCell: "text-[#59616e]",
                cell: "text-[#191d24]",
                rowHover: "bg-[#f4f6f8]",
              }}
            />
          </View>

          <View class="h-[96px] rounded-[8px] border border-[#e3e7ec] bg-white p-2">
            <Scroll class="flex-1">
              <Text class="text-[11px] text-[#59616e]">{logs().join("\n")}</Text>
            </Scroll>
          </View>
        </View>
      </View>
    </View>
  );
}
mount(Board);
