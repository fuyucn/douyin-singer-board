import { Clipboard, effect, Image, mount, Scroll, signal, Storage, Text, View } from "nsh";
import { Button, DataTable, Input, type DataTableColumn } from "nsh/base";
import Client from "./listener-bundle.js";
import { Matcher } from "./src/matcher";
import { DEFAULT_SING_PREFIX, type Config, type DanmuInfo } from "./src/types";
import {
  addTrack,
  playlists as fetchPlaylists,
  qrCheck,
  qrKey,
  search,
  type Playlist,
  type Track,
} from "./plugins/kugou";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

type Tab = "songs" | "played" | "blacklist" | "kugou";
type KugouSession = { token: string; userid: string; dfid?: string; nickname?: string };
type PlayedInfo = DanmuInfo & { played_at: number };

const songColumns: DataTableColumn[] = [
  { key: "idx", title: "#", width: 40, align: "end" },
  { key: "user", title: "用户", width: 140 },
  { key: "song", title: "歌曲", width: 220 },
  { key: "medal", title: "粉丝团", width: 90 },
  { key: "time", title: "时间", width: 80 },
];

const playedColumns: DataTableColumn[] = [
  { key: "idx", title: "#", width: 40, align: "end" },
  { key: "user", title: "用户", width: 120 },
  { key: "song", title: "歌曲", width: 200 },
  { key: "time", title: "点歌时间", width: 90 },
  { key: "played", title: "标记时间", width: 90 },
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
    blacklist: [],
    auto_sync: false,
  });
  const status = signal("未连接");
  const roomName = signal("");
  const songs = signal<DanmuInfo[]>([]);
  const played = signal<PlayedInfo[]>([]);
  const logs = signal<string[]>([]);
  const manual = signal("");
  const blackInput = signal("");
  const activeTab = signal<Tab>("songs");
  const selectedRow = signal<number | null>(null);

  const kugou = signal<KugouSession | null>(null);
  const kgState = signal("idle");
  const qr = signal<{ key: string; image: string } | null>(null);
  const lists = signal<Playlist[]>([]);
  const kgQuery = signal("");
  const kgResults = signal<Track[]>([]);
  const kgBusy = signal(false);
  const kgMsg = signal("");
  let loginGen = 0;

  const matcher = new Matcher(config());
  effect(() => matcher.reload(config()));

  let configLoaded = false;
  Storage.getItem("board.config")
    .then((raw) => {
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          config.set({ ...config(), ...saved, blacklist: Array.isArray(saved.blacklist) ? saved.blacklist : [] });
        } catch {}
      }
    })
    .catch(() => {})
    .finally(() => { configLoaded = true; });
  effect(() => {
    if (!configLoaded) return;
    Storage.setItem("board.config", JSON.stringify(config())).catch(() => {});
  });

  const saveSession = (sess: KugouSession) => {
    kugou.set(sess);
    Storage.setItem("kugou.session", JSON.stringify(sess)).catch(() => {});
  };

  const loadLists = async (sess: KugouSession | null = kugou()) => {
    if (!sess) return;
    try {
      const arr = await fetchPlaylists(sess.token, sess.userid, sess.dfid ?? "-");
      lists.set(arr);
      if (arr.length > 0) {
        const wanted = arr.find((p) => p.listid === config().target_playlist_id);
        const chosen = wanted ?? arr[0];
        patch({ target_playlist_id: chosen.listid, target_playlist_name: chosen.name });
      }
      kgState.set("ok");
      kgMsg.set("");
    } catch (e: any) {
      kgState.set("error");
      kgMsg.set("歌单加载失败: " + String(e?.message ?? e));
      log("酷狗歌单加载失败");
    }
  };

  Storage.getItem("kugou.session")
    .then((raw) => {
      if (!raw) return;
      try {
        const sess = JSON.parse(raw) as KugouSession;
        if (sess?.token && sess?.userid) {
          kugou.set(sess);
          loadLists(sess);
        }
      } catch {}
    })
    .catch(() => {});

  const pollQr = async (key: string, gen: number) => {
    if (gen !== loginGen) return;
    try {
      const r = await qrCheck(key);
      if (gen !== loginGen) return;
      if (r.status === 4 && r.token && r.userid) {
        const sess: KugouSession = {
          token: r.token,
          userid: r.userid,
          dfid: "-",
          nickname: r.nickname,
        };
        saveSession(sess);
        qr.set(null);
        log(`酷狗登录成功: ${r.nickname ?? r.userid}`);
        loadLists(sess);
        return;
      }
      if (r.status === 0) { kgState.set("expired"); return; }
      kgState.set(r.status === 2 ? "scanned" : "waiting");
      setTimeout(() => pollQr(key, gen), 2000);
    } catch (e: any) {
      if (gen !== loginGen) return;
      kgState.set("error");
      kgMsg.set("扫码状态失败: " + String(e?.message ?? e));
    }
  };

  const startLogin = async () => {
    const gen = (loginGen += 1);
    kgState.set("loading");
    kgMsg.set("");
    qr.set(null);
    try {
      const r = await qrKey();
      if (gen !== loginGen) return;
      qr.set(r);
      kgState.set("waiting");
      pollQr(r.key, gen);
    } catch (e: any) {
      kgState.set("error");
      kgMsg.set("二维码生成失败: " + String(e?.message ?? e));
    }
  };

  const logout = () => {
    loginGen += 1;
    kugou.set(null);
    qr.set(null);
    lists.set([]);
    kgResults.set([]);
    kgState.set("idle");
    kgMsg.set("");
    Storage.removeItem("kugou.session").catch(() => {});
    log("酷狗已退出登录");
  };

  const doSearch = async () => {
    const keyword = kgQuery().trim();
    if (!keyword || !kugou()) return;
    kgBusy.set(true);
    kgMsg.set("");
    try {
      const arr = await search({ keyword, pagesize: 6 });
      kgResults.set(arr);
      kgMsg.set(arr.length === 0 ? "没有找到歌曲" : "");
    } catch (e: any) {
      kgMsg.set("搜索失败: " + String(e?.message ?? e));
    } finally {
      kgBusy.set(false);
    }
  };

  const addToPlaylist = async (track: Track) => {
    const sess = kugou();
    const target = config().target_playlist_id;
    if (!sess) { kgMsg.set("请先登录酷狗"); return; }
    if (!target) { kgMsg.set("请先选择目标歌单"); return; }
    kgBusy.set(true);
    try {
      const res = await addTrack(sess.token, sess.userid, target, track, sess.dfid ?? "-");
      if (res.status === 1) {
        kgMsg.set(`已加入 ${config().target_playlist_name || "歌单"}: ${track.name}`);
        log(`酷狗已加入: ${track.name}`);
      } else {
        kgMsg.set(`加入失败 (status ${res.status}): ${res.msg ?? ""}`);
        log(`酷狗加入失败: ${track.name}`);
      }
    } catch (e: any) {
      kgMsg.set("加入失败: " + String(e?.message ?? e));
    } finally {
      kgBusy.set(false);
    }
  };

  const addKugouToBoard = (track: Track) => {
    addSong({
      msg_id: `kugou_${track.hash}_${Date.now()}`,
      uid: "manual",
      uname: "主播",
      song_name: track.name,
      raw_msg: `${track.name} - ${track.artist}`,
      medal_level: 0,
      medal_name: "",
      send_time: Math.floor(Date.now() / 1000),
    });
  };

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
  const bl = () => config().blacklist ?? [];
  const kgLabel = () => {
    switch (kgState()) {
      case "loading": return "生成二维码…";
      case "waiting": return "等待扫码";
      case "scanned": return "已扫码，请在手机上确认";
      case "expired": return "二维码已过期，重新生成";
      case "error": return "登录失败";
      case "ok": return "已登录";
      default: return "未登录";
    }
  };

  const songRows = () =>
    songs().map((s, i) => ({
      idx: String(i + 1),
      user: s.uname || "?",
      song: s.song_name,
      medal: s.medal_level > 0 ? `${s.medal_name} ${s.medal_level}` : "—",
      time: clock(s.send_time),
    }));

  const playedRows = () =>
    played().map((s, i) => ({
      idx: String(i + 1),
      user: s.uname || "?",
      song: s.song_name,
      time: clock(s.send_time),
      played: clock(s.played_at),
    }));

  const addSong = (danmu: DanmuInfo) => {
    if (songs().some((s) => s.song_name === danmu.song_name) || played().some((s) => s.song_name === danmu.song_name)) {
      log(`重复跳过: ${danmu.song_name}`);
      return;
    }
    const max = config().max_songs_per_user;
    if (max > 0 && danmu.uid !== "manual") {
      const count = played().filter((s) => s.uid === danmu.uid).length;
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

  const copyNames = (list: { song_name: string }[], label: string) => {
    Clipboard.writeText(list.map((s) => s.song_name).join("\n"));
    log(`已复制${label} ${list.length} 首`);
  };

  const markPlayed = (index: number) => {
    const song = songs()[index];
    if (!song) return;
    songs.update((v) => v.filter((_, i) => i !== index));
    played.update((v) => [{ ...song, played_at: Math.floor(Date.now() / 1000) }, ...v]);
    selectedRow.set(null);
    log(`🎵 已点: ${song.uname} - ${song.song_name}`);

    const sess = kugou();
    const target = config().target_playlist_id;
    if ((config().auto_sync ?? false) && sess && target) {
      search({ keyword: song.song_name, pagesize: 3 })
        .then((tracks) => {
          const track = tracks[0];
          if (!track) { log(`酷狗未找到: ${song.song_name}`); return; }
          return addTrack(sess.token, sess.userid, target, track, sess.dfid ?? "-").then((res) => {
            log(res.status === 1 ? `酷狗自动加入: ${track.name}` : `酷狗自动加入失败: ${track.name} (${res.status})`);
          });
        })
        .catch((e: any) => log("酷狗自动同步失败: " + String(e?.message ?? e)));
    }
  };

  const removeSong = (index: number) => {
    const song = songs()[index];
    if (!song) return;
    songs.update((v) => v.filter((_, i) => i !== index));
    selectedRow.set(null);
    log(`删除: ${song.uname} - ${song.song_name}`);
  };

  const addBlack = () => {
    const name = blackInput().trim();
    if (!name) return;
    if (bl().includes(name)) { log(`黑名单已有: ${name}`); return; }
    patch({ blacklist: [...bl(), name] });
    blackInput.set("");
    log(`加入黑名单: ${name}`);
  };

  const removeBlack = (name: string) => {
    patch({ blacklist: bl().filter((s) => s !== name) });
    log(`移出黑名单: ${name}`);
  };

  const tabButton = (key: Tab, label: string) => (
    <Button
      onPress={() => { activeTab.set(key); selectedRow.set(null); }}
      class={`rounded-[6px] px-3 py-1 ${activeTab() === key ? "bg-[#2f6fb0]" : "border border-[#d7dce2] active:bg-[#f4f6f8]"}`}
    >
      <Text class={`text-[12px] ${activeTab() === key ? "text-white" : "text-[#191d24]"}`}>{label}</Text>
    </Button>
  );

  return (
    <View class="flex-1 bg-[#f4f6f8]">
      <View class="h-[52px] flex-row items-center gap-3 border-b border-[#e3e7ec] bg-white px-4">
        <Text class="text-sm font-semibold text-[#191d24]">SUSUSongBoard</Text>
        <Text class="text-[11px] text-[#88919f]">NSH 迁移版</Text>
        <View class={`h-2 w-2 rounded-full ${status() === "已连接" ? "bg-[#2e8a66]" : "bg-[#c2c8d0]"}`} />
        <Text class="text-xs text-[#59616e]">{status()}</Text>
        <Text class="text-xs text-[#88919f]">{roomName()}</Text>
        <View class="flex-1" />
        <Text class="text-[11px] text-[#88919f]">0.3.0</Text>
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
            <Text class="text-[12px] text-[#59616e]">待处理：{songs().length}</Text>
            <Text class="text-[12px] text-[#59616e]">已点：{played().length}</Text>
            <Text class="text-[12px] text-[#59616e]">黑名单：{bl().length}</Text>
            <Text class="text-[12px] text-[#59616e]">连接：{status()}</Text>
          </View>
        </View>

        <View class="flex-1 p-3 gap-2">
          <View class="flex-row items-center gap-2">
            {tabButton("songs", `点歌 ${songs().length}`)}
            {tabButton("played", `已点 ${played().length}`)}
            {tabButton("blacklist", `黑名单 ${bl().length}`)}
            {tabButton("kugou", kugou() ? "酷狗 ✓" : "酷狗")}
            <View class="flex-1" />
            <If when={activeTab() === "songs"}>
              <Input
                value={manual()}
                onChange={({ value }) => manual.set(value)}
                onSubmit={addManual}
                placeholder="手动添加歌曲"
                class="w-36 rounded-[6px] border border-[#d7dce2] px-2 py-1 text-[12px] text-[#191d24]"
              />
              <Button onPress={addManual} class="rounded-[6px] bg-[#2f6fb0] px-3 py-1 active:opacity-80">
                <Text class="text-[12px] text-white">添加</Text>
              </Button>
              <Button onPress={simulate} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
                <Text class="text-[12px] text-[#191d24]">模拟</Text>
              </Button>
            </If>
            <If when={activeTab() === "blacklist"}>
              <Input
                value={blackInput()}
                onChange={({ value }) => blackInput.set(value)}
                onSubmit={addBlack}
                placeholder="歌曲名（精确匹配）"
                class="w-44 rounded-[6px] border border-[#d7dce2] px-2 py-1 text-[12px] text-[#191d24]"
              />
              <Button onPress={addBlack} class="rounded-[6px] bg-[#2f6fb0] px-3 py-1 active:opacity-80">
                <Text class="text-[12px] text-white">加入</Text>
              </Button>
            </If>
            <If when={activeTab() === "kugou" && kugou()}>
              <Input
                value={kgQuery()}
                onChange={({ value }) => kgQuery.set(value)}
                onSubmit={doSearch}
                placeholder="搜索酷狗歌曲"
                class="w-40 rounded-[6px] border border-[#d7dce2] px-2 py-1 text-[12px] text-[#191d24]"
              />
              <Button onPress={doSearch} class="rounded-[6px] bg-[#2f6fb0] px-3 py-1 active:opacity-80">
                <Text class="text-[12px] text-white">搜索</Text>
              </Button>
            </If>
          </View>

          <View class="flex-row items-center gap-2">
            <If when={activeTab() === "songs"}>
              <Text class="text-[11px] text-[#88919f]">选中行后可标记已点/删除；双击行也可标记</Text>
              <View class="flex-1" />
              <Button
                onPress={() => selectedRow() !== null && markPlayed(selectedRow()!)}
                class={`rounded-[6px] px-3 py-1 ${selectedRow() !== null ? "bg-[#2f6fb0] active:opacity-80" : "bg-[#e3e7ec]"}`}
              >
                <Text class={`text-[12px] ${selectedRow() !== null ? "text-white" : "text-[#88919f]"}`}>标记已点</Text>
              </Button>
              <Button
                onPress={() => selectedRow() !== null && removeSong(selectedRow()!)}
                class={`rounded-[6px] border border-[#d7dce2] px-3 py-1 ${selectedRow() !== null ? "active:bg-[#f4f6f8]" : "opacity-50"}`}
              >
                <Text class="text-[12px] text-[#191d24]">删除</Text>
              </Button>
              <Button onPress={() => copyNames(songs(), "点歌")} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
                <Text class="text-[12px] text-[#191d24]">复制全部</Text>
              </Button>
              <Button onPress={() => { songs.set([]); selectedRow.set(null); }} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
                <Text class="text-[12px] text-[#191d24]">清空</Text>
              </Button>
            </If>
            <If when={activeTab() === "played"}>
              <Text class="text-[11px] text-[#88919f]">已点歌单（本次会话）</Text>
              <View class="flex-1" />
              <Button onPress={() => copyNames(played(), "已点")} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
                <Text class="text-[12px] text-[#191d24]">复制已点</Text>
              </Button>
              <Button onPress={() => played.set([])} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
                <Text class="text-[12px] text-[#191d24]">清空已点</Text>
              </Button>
            </If>
            <If when={activeTab() === "blacklist"}>
              <Text class="text-[11px] text-[#88919f]">精确匹配歌曲名；命中后不再进入点歌列表</Text>
            </If>
            <If when={activeTab() === "kugou"}>
              <Text class="text-[11px] text-[#88919f]">账号只保存在本机；加歌单需要选目标歌单</Text>
              <View class="flex-1" />
              <Button onPress={() => loadLists()} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
                <Text class="text-[12px] text-[#191d24]">刷新歌单</Text>
              </Button>
              <Button onPress={() => patch({ auto_sync: !(config().auto_sync ?? false) })} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
                <Text class="text-[12px] text-[#191d24]">自动同步: {(config().auto_sync ?? false) ? "开" : "关"}</Text>
              </Button>
            </If>
          </View>

          <View class="flex-1 rounded-[8px] border border-[#e3e7ec] bg-white">
            <If when={activeTab() === "songs"}>
              <DataTable
                columns={songColumns}
                data={songRows()}
                rowHeight={40}
                class="flex-1"
                empty={<Text class="text-[12px] text-[#88919f]">还没有点歌，连接直播间等待弹幕…</Text>}
                onSelectionChange={({ selection }: any) => selectedRow.set(selection?.row ?? null)}
                onDoublePress={({ target }: any) => { if (target?.row != null) markPlayed(target.row); }}
                classes={{ header: "bg-[#f0f2f5]", headerCell: "text-[#59616e]", cell: "text-[#191d24]", rowHover: "bg-[#f4f6f8]" }}
              />
            </If>
            <If when={activeTab() === "played"}>
              <DataTable
                columns={playedColumns}
                data={playedRows()}
                rowHeight={40}
                class="flex-1"
                empty={<Text class="text-[12px] text-[#88919f]">还没有已点歌曲</Text>}
                classes={{ header: "bg-[#f0f2f5]", headerCell: "text-[#59616e]", cell: "text-[#191d24]", rowHover: "bg-[#f4f6f8]" }}
              />
            </If>
            <If when={activeTab() === "blacklist"}>
              <If when={bl().length === 0} else={
                <Scroll class="flex-1 p-2">
                  <View class="gap-1">
                    <Each of={bl()} key={(s: string) => s}>
                      {(item: any) => (
                        <View class="flex-row items-center gap-2 border-b border-[#e3e7ec] px-2 py-2">
                          <Text class="flex-1 text-[13px] text-[#191d24]">{item()}</Text>
                          <Button onPress={() => removeBlack(item())} class="rounded-[6px] border border-[#d7dce2] px-2 py-1 active:bg-[#f4f6f8]">
                            <Text class="text-[11px] text-[#191d24]">移除</Text>
                          </Button>
                        </View>
                      )}
                    </Each>
                  </View>
                </Scroll>
              }>
                <Text class="p-4 text-[12px] text-[#88919f]">黑名单为空；命中的歌曲不会进入点歌列表</Text>
              </If>
            </If>
            <If when={activeTab() === "kugou"}>
              <Scroll class="flex-1 p-4">
                <If when={!kugou()}>
                  <View class="gap-3">
                    <Text class="text-[13px] font-semibold text-[#191d24]">酷狗登录</Text>
                    <Text class="text-[12px] text-[#59616e]">扫码登录后可以搜索歌曲、加入歌单；登录令牌只保存在本机。</Text>
                    <Button onPress={startLogin} class="self-start rounded-[6px] bg-[#2f6fb0] px-3 py-2 active:opacity-80">
                      <Text class="text-[12px] text-white">生成登录二维码 / 刷新</Text>
                    </Button>
                    <If when={qr()}>
                      <Image src={qr()!.image} class="h-[180px] w-[180px] rounded-[6px] border border-[#e3e7ec]" />
                    </If>
                    <Text class="text-[12px] text-[#59616e]">状态：{kgLabel()}</Text>
                    <Text class="text-[11px] text-[#88919f]">{kgMsg()}</Text>
                  </View>
                </If>
                <If when={kugou()}>
                  <View class="gap-3">
                    <View class="flex-row items-center gap-2">
                      <Text class="text-[13px] font-semibold text-[#191d24]">酷狗账号</Text>
                      <Text class="text-[12px] text-[#59616e]">{kugou()!.nickname ?? kugou()!.userid}</Text>
                      <View class="flex-1" />
                      <Button onPress={logout} class="rounded-[6px] border border-[#d7dce2] px-3 py-1 active:bg-[#f4f6f8]">
                        <Text class="text-[12px] text-[#191d24]">退出登录</Text>
                      </Button>
                    </View>

                    <Text class="text-[12px] font-semibold text-[#191d24]">目标歌单</Text>
                    <If when={lists().length === 0} else={
                      <View class="gap-1">
                        <Each of={lists()} key={(p: any) => p.listid}>
                          {(item: any) => (
                            <View class={`flex-row items-center gap-2 rounded-[6px] border px-2 py-2 ${config().target_playlist_id === item().listid ? "border-[#2f6fb0] bg-[#eef4fb]" : "border-[#e3e7ec]"}`}>
                              <Text class="flex-1 text-[13px] text-[#191d24]">{item().name}</Text>
                              <Text class="text-[11px] text-[#88919f]">{item().count} 首</Text>
                              <Button
                                onPress={() => { patch({ target_playlist_id: item().listid, target_playlist_name: item().name }); log(`目标歌单: ${item().name}`); }}
                                class="rounded-[6px] border border-[#d7dce2] px-2 py-1 active:bg-[#f4f6f8]"
                              >
                                <Text class="text-[11px] text-[#191d24]">{config().target_playlist_id === item().listid ? "当前" : "设为目标"}</Text>
                              </Button>
                            </View>
                          )}
                        </Each>
                      </View>
                    }>
                      <Text class="text-[12px] text-[#88919f]">暂无歌单，点上方“刷新歌单”重试</Text>
                    </If>

                    <Text class="text-[12px] font-semibold text-[#191d24]">搜索结果</Text>
                    <If when={kgResults().length === 0} else={
                      <View class="gap-1">
                        <Each of={kgResults()} key={(t: any) => t.hash}>
                          {(item: any) => (
                            <View class="flex-row items-center gap-2 border-b border-[#e3e7ec] px-1 py-2">
                              <View class="flex-1">
                                <Text class="text-[13px] text-[#191d24]">{item().name}</Text>
                                <Text class="text-[11px] text-[#88919f]">{item().artist}</Text>
                              </View>
                              <Button onPress={() => addToPlaylist(item())} class="rounded-[6px] bg-[#2f6fb0] px-2 py-1 active:opacity-80">
                                <Text class="text-[11px] text-white">加入歌单</Text>
                              </Button>
                              <Button onPress={() => addKugouToBoard(item())} class="rounded-[6px] border border-[#d7dce2] px-2 py-1 active:bg-[#f4f6f8]">
                                <Text class="text-[11px] text-[#191d24]">加入列表</Text>
                              </Button>
                            </View>
                          )}
                        </Each>
                      </View>
                    }>
                      <Text class="text-[12px] text-[#88919f]">在上方搜索框输入歌名</Text>
                    </If>
                    <Text class="text-[11px] text-[#88919f]">{kgMsg()}</Text>
                  </View>
                </If>
              </Scroll>
            </If>
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
