import { Clipboard, colorScheme, effect, Image, mount, Scroll, setColorScheme, signal, Storage, Text, View } from "nsh";
import icon from "./assets/icon.png";
import { Button, DataTable, Dialog, Input, type DataTableColumn } from "nsh/base";
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

type Tab = "songs" | "played" | "blacklist";
type PluginId = "kugou" | "netease";
const PLUGINS = [
  { id: "kugou", name: "酷狗音乐", version: "内置 v0.1.0", note: "登录、歌单、搜索、自动同步" },
  { id: "netease", name: "网易云音乐", version: "未接入", note: "占位；同一时间只启用一个平台" },
];
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
    active_plugin: "kugou",
  });
  const status = signal("未连接");
  const roomName = signal("");
  const songs = signal<DanmuInfo[]>([]);
  const played = signal<PlayedInfo[]>([]);
  const logs = signal<string[]>([]);
  const manual = signal("");
  const blackInput = signal("");
  const activeTab = signal<Tab>("songs");
  const settingsOpen = signal(false);
  const themeMode = signal<"system" | "light" | "dark">("system");
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

  const applyTheme = (mode: "system" | "light" | "dark") => {
    themeMode.set(mode);
    setColorScheme(mode);
    Storage.setItem("board.theme", mode).catch(() => {});
  };

  Storage.getItem("board.theme")
    .then((raw) => {
      if (raw === "light" || raw === "dark" || raw === "system") applyTheme(raw);
    })
    .catch(() => {});

  const toggleTheme = () => {
    applyTheme(colorScheme() === "dark" ? "light" : "dark");
  };

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
    if (config().active_plugin === "kugou" && (config().auto_sync ?? false) && sess && target) {
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

  const running = () => ["解析房间...", "连接中...", "已连接"].includes(status());

  const tabButton = (key: Tab, label: string) => (
    <Button
      onPress={() => { activeTab.set(key); selectedRow.set(null); }}
      class={`rounded-[6px] px-3 py-1 ${activeTab() === key ? "bg-[#2f6fb0] dark:bg-[#3d7fbe]" : "border border-[#d7dce2] dark:border-[#3a4048] active:bg-[#f4f6f8] dark:bg-[#17191b]"}`}
    >
      <Text class={`text-[12px] ${activeTab() === key ? "text-white" : "text-[#191d24] dark:text-[#e7e9ec]"}`}>{label}</Text>
    </Button>
  );

  return (
    <View class="flex-1 bg-[#f4f6f8] dark:bg-[#17191b]">
      <View class="h-[52px] flex-row items-center gap-3 border-b border-[#e3e7ec] dark:border-[#2b3036] bg-white dark:bg-[#1f2227] px-4">
        <Image src={icon} class="h-6 w-6 rounded-[6px]" />
        <Text class="text-sm font-semibold whitespace-nowrap text-[#191d24] dark:text-[#e7e9ec]">SUSUSongBoard</Text>
        <View class={`h-2 w-2 rounded-full ${status() === "已连接" ? "bg-[#2e8a66]" : "bg-[#c2c8d0] dark:bg-[#4a515a]"}`} />
        <Text class="text-xs text-[#59616e] dark:text-[#a9b1bd]">{status()}</Text>
        <Text class="max-w-[180px] truncate text-xs text-[#88919f] dark:text-[#7e8795]">{roomName()}</Text>
        <View class="flex-1" />
        <Button onPress={toggleTheme} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
          <Text class="text-[13px] text-[#191d24] dark:text-[#e7e9ec]">{colorScheme() === "dark" ? "☀" : "☾"}</Text>
        </Button>
        <Button onPress={() => settingsOpen.set(true)} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
          <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">设置</Text>
        </Button>
        <Button
          onPress={() => (running() ? stop() : start())}
          class={`rounded-[6px] px-3 py-1 active:opacity-80 ${running() ? "border border-[#d7dce2] dark:border-[#3a4048] bg-white dark:bg-[#1f2227]" : "bg-[#2f6fb0] dark:bg-[#3d7fbe]"}`}
        >
          <Text class={`text-[12px] ${running() ? "text-[#191d24] dark:text-[#e7e9ec]" : "text-white"}`}>{running() ? "停止" : "开始"}</Text>
        </Button>
      </View>

      <View class="flex-1 flex-row">
        <Scroll class="h-full w-[280px] border-r border-[#e3e7ec] dark:border-[#2b3036] bg-white dark:bg-[#1f2227]">
          <View class="gap-3 p-4">
          <Text class="text-[13px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">直播间配置</Text>
          <View class="gap-2">
            <View class="flex-row items-center justify-between gap-2">
              <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">抖音直播间 ID</Text>
              <If when={roomName()}>
                <View class="flex-row items-center gap-1">
                  <View class="h-1.5 w-1.5 rounded-full bg-[#2e8a66]" />
                  <Text class="max-w-[120px] truncate text-[11px] text-[#59616e] dark:text-[#a9b1bd]">{roomName()}</Text>
                </View>
              </If>
            </View>
            <Input
              value={config().room_id}
              onChange={({ value }) => patch({ room_id: value })}
              onSubmit={start}
              placeholder="例如 145997388006"
              class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-2 text-[13px] text-[#191d24] dark:text-[#e7e9ec]"
            />
            <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">点歌指令模板</Text>
            <Input
              value={config().sing_prefix}
              onChange={({ value }) => patch({ sing_prefix: value })}
              class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-2 text-[13px] text-[#191d24] dark:text-[#e7e9ec]"
            />
          </View>

          <View class="h-px bg-[#e3e7ec] dark:bg-[#2b3036]" />
          <Text class="text-[13px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">点歌规则</Text>
          <View class="gap-2">
            <View class="flex-row items-center gap-2">
              <Text class="w-28 text-[12px] text-[#59616e] dark:text-[#a9b1bd]">最低粉丝团等级</Text>
              <Input
                value={String(config().fans_level)}
                onChange={({ value }) => patch({ fans_level: num(value) })}
                class="w-16 rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 text-[13px] text-[#191d24] dark:text-[#e7e9ec]"
              />
            </View>
            <View class="flex-row items-center gap-2">
              <Text class="w-28 text-[12px] text-[#59616e] dark:text-[#a9b1bd]">点歌冷却(秒)</Text>
              <Input
                value={String(config().sing_cd)}
                onChange={({ value }) => patch({ sing_cd: num(value) })}
                class="w-16 rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 text-[13px] text-[#191d24] dark:text-[#e7e9ec]"
              />
            </View>
            <View class="flex-row items-center gap-2">
              <Text class="w-28 text-[12px] text-[#59616e] dark:text-[#a9b1bd]">重复点歌冷却(秒)</Text>
              <Input
                value={String(config().cooldown_seconds)}
                onChange={({ value }) => patch({ cooldown_seconds: num(value) })}
                class="w-16 rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 text-[13px] text-[#191d24] dark:text-[#e7e9ec]"
              />
            </View>
            <View class="flex-row items-center gap-2">
              <Text class="w-28 text-[12px] text-[#59616e] dark:text-[#a9b1bd]">单人单场上限</Text>
              <Input
                value={String(config().max_songs_per_user)}
                onChange={({ value }) => patch({ max_songs_per_user: num(value) })}
                class="w-16 rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 text-[13px] text-[#191d24] dark:text-[#e7e9ec]"
              />
            </View>
          </View>

          <If when={config().active_plugin === "kugou"}>
            <View class="h-px bg-[#e3e7ec] dark:bg-[#2b3036]" />
            <Text class="text-[13px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">酷狗歌单</Text>
            <If when={kugou()} else={
              <View class="gap-1">
                <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">尚未登录酷狗</Text>
                <Button onPress={() => settingsOpen.set(true)} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                  <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">去设置登录</Text>
                </Button>
              </View>
            }>
              <View class="gap-1">
                <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">歌单：{config().target_playlist_name || "未选择"}</Text>
                <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">id: {config().target_playlist_id || "—"} · {kugou()!.nickname ?? kugou()!.userid}</Text>
                <View class="flex-row gap-2">
                  <Button onPress={() => settingsOpen.set(true)} class="flex-1 rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                    <Text class="text-[11px] text-[#191d24] dark:text-[#e7e9ec]">管理酷狗</Text>
                  </Button>
                  <Button onPress={() => patch({ auto_sync: !(config().auto_sync ?? false) })} class={`flex-1 rounded-[6px] px-2 py-1 ${config().auto_sync ? "bg-[#2f6fb0] dark:bg-[#3d7fbe] active:opacity-80" : "border border-[#d7dce2] dark:border-[#3a4048] active:bg-[#f4f6f8] dark:bg-[#17191b]"}`}>
                    <Text class={`text-[11px] ${config().auto_sync ? "text-white" : "text-[#191d24] dark:text-[#e7e9ec]"}`}>{config().auto_sync ? "同步中" : "自动同步"}</Text>
                  </Button>
                </View>
              </View>
            </If>
          </If>

          <View class="h-px bg-[#e3e7ec] dark:bg-[#2b3036]" />
          <Text class="text-[13px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">本次会话</Text>
          <View class="gap-1">
            <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">待处理：{songs().length}</Text>
            <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">已点：{played().length}</Text>
            <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">黑名单：{bl().length}</Text>
            <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">连接：{status()}</Text>
          </View>

          <View class="h-px bg-[#e3e7ec] dark:bg-[#2b3036]" />
          <Text class="text-[13px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">手动点歌</Text>
          <View class="flex-row gap-2">
            <Input
              value={manual()}
              onChange={({ value }) => manual.set(value)}
              onSubmit={addManual}
              placeholder="输入歌曲名称..."
              class="min-w-0 flex-1 rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 text-[12px] text-[#191d24] dark:text-[#e7e9ec]"
            />
            <Button onPress={addManual} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
              <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">添加</Text>
            </Button>
          </View>
          <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">SUSUSongBoard v0.4.0</Text>
          </View>
        </Scroll>

        <View class="flex-1 p-3 gap-2">
          <View class="flex-row items-center gap-2">
            {tabButton("songs", `点歌 ${songs().length}`)}
            {tabButton("played", `已点歌单 ${played().length}`)}
            {tabButton("blacklist", `黑名单 ${bl().length}`)}
            <View class="flex-1" />
            <If when={activeTab() === "blacklist"}>
              <Input
                value={blackInput()}
                onChange={({ value }) => blackInput.set(value)}
                onSubmit={addBlack}
                placeholder="歌曲名（精确匹配）"
                class="w-44 rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 text-[12px] text-[#191d24] dark:text-[#e7e9ec]"
              />
              <Button onPress={addBlack} class="rounded-[6px] bg-[#2f6fb0] dark:bg-[#3d7fbe] px-3 py-1 active:opacity-80">
                <Text class="text-[12px] text-white">加入</Text>
              </Button>
            </If>
          </View>

          <View class="flex-row items-center gap-2">
            <If when={activeTab() === "songs"}>
              <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">选中行后可标记已点/删除；双击行也可标记</Text>
              <View class="flex-1" />
              <Button
                onPress={() => selectedRow() !== null && markPlayed(selectedRow()!)}
                class={`rounded-[6px] px-3 py-1 ${selectedRow() !== null ? "bg-[#2f6fb0] dark:bg-[#3d7fbe] active:opacity-80" : "bg-[#e3e7ec] dark:bg-[#2b3036]"}`}
              >
                <Text class={`text-[12px] ${selectedRow() !== null ? "text-white" : "text-[#88919f] dark:text-[#7e8795]"}`}>标记已点</Text>
              </Button>
              <Button
                onPress={() => selectedRow() !== null && removeSong(selectedRow()!)}
                class={`rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 ${selectedRow() !== null ? "active:bg-[#f4f6f8] dark:bg-[#17191b]" : "opacity-50"}`}
              >
                <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">删除</Text>
              </Button>
              <Button onPress={() => copyNames(songs(), "点歌")} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">复制全部</Text>
              </Button>
              <Button onPress={() => { songs.set([]); selectedRow.set(null); }} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">清空</Text>
              </Button>
            </If>
            <If when={activeTab() === "played"}>
              <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">已点歌单（本次会话）</Text>
              <View class="flex-1" />
              <Button onPress={() => copyNames(played(), "已点")} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">复制已点</Text>
              </Button>
              <Button onPress={() => played.set([])} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">清空已点</Text>
              </Button>
            </If>
            <If when={activeTab() === "blacklist"}>
              <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">精确匹配歌曲名；命中后不再进入点歌列表</Text>
            </If>
          </View>

          <View class="flex-1 rounded-[8px] border border-[#e3e7ec] dark:border-[#2b3036] bg-white dark:bg-[#1f2227]">
            <If when={activeTab() === "songs"}>
              <DataTable
                columns={songColumns}
                data={songRows()}
                rowHeight={40}
                class="flex-1"
                empty={<Text class="text-[12px] text-[#88919f] dark:text-[#7e8795]">还没有点歌，连接直播间等待弹幕…</Text>}
                onSelectionChange={({ selection }: any) => selectedRow.set(selection?.row ?? null)}
                onDoublePress={({ target }: any) => { if (target?.row != null) markPlayed(target.row); }}
                classes={{ header: "bg-[#f0f2f5] dark:bg-[#23272d]", headerCell: "text-[#59616e] dark:text-[#a9b1bd]", cell: "text-[#191d24] dark:text-[#e7e9ec]", rowHover: "bg-[#f4f6f8] dark:bg-[#17191b]" }}
              />
            </If>
            <If when={activeTab() === "played"}>
              <DataTable
                columns={playedColumns}
                data={playedRows()}
                rowHeight={40}
                class="flex-1"
                empty={<Text class="text-[12px] text-[#88919f] dark:text-[#7e8795]">还没有已点歌曲</Text>}
                classes={{ header: "bg-[#f0f2f5] dark:bg-[#23272d]", headerCell: "text-[#59616e] dark:text-[#a9b1bd]", cell: "text-[#191d24] dark:text-[#e7e9ec]", rowHover: "bg-[#f4f6f8] dark:bg-[#17191b]" }}
              />
            </If>
            <If when={activeTab() === "blacklist"}>
              <If when={bl().length === 0} else={
                <Scroll class="flex-1 p-2">
                  <View class="gap-1">
                    <Each of={bl()} key={(s: string) => s}>
                      {(item: any) => (
                        <View class="flex-row items-center gap-2 border-b border-[#e3e7ec] dark:border-[#2b3036] px-2 py-2">
                          <Text class="flex-1 text-[13px] text-[#191d24] dark:text-[#e7e9ec]">{item()}</Text>
                          <Button onPress={() => removeBlack(item())} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                            <Text class="text-[11px] text-[#191d24] dark:text-[#e7e9ec]">移除</Text>
                          </Button>
                        </View>
                      )}
                    </Each>
                  </View>
                </Scroll>
              }>
                <Text class="p-4 text-[12px] text-[#88919f] dark:text-[#7e8795]">黑名单为空；命中的歌曲不会进入点歌列表</Text>
              </If>
            </If>
          </View>

          <View class="h-[96px] rounded-[8px] border border-[#e3e7ec] dark:border-[#2b3036] bg-white dark:bg-[#1f2227] p-2">
            <Scroll class="flex-1">
              <Text class="text-[11px] text-[#59616e] dark:text-[#a9b1bd]">{logs().join("\n")}</Text>
            </Scroll>
          </View>
        </View>
      </View>

      <Dialog
        open={settingsOpen()}
        onOpenChange={({ open }: any) => settingsOpen.set(open)}
        class="w-[560px] rounded-[10px] border border-[#e3e7ec] dark:border-[#2b3036] bg-white dark:bg-[#1f2227]"
        backdropClass="bg-black/30"
      >
        <View class="h-[620px]">
          <View class="h-[48px] flex-row items-center border-b border-[#e3e7ec] dark:border-[#2b3036] px-4">
            <Text class="text-[14px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">设置</Text>
            <View class="flex-1" />
            <Button onPress={() => settingsOpen.set(false)} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-3 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
              <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">关闭</Text>
            </Button>
          </View>
          <Scroll class="flex-1 p-4">
            <View class="gap-3">
              <Text class="text-[13px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">外观</Text>
              <View class="flex-row gap-2">
                <Each of={(["system", "light", "dark"] as const)} key={(m: any) => m}>
                  {(mode: any) => (
                    <Button
                      onPress={() => applyTheme(mode())}
                      class={`rounded-[6px] px-3 py-1 ${themeMode() === mode() ? "bg-[#2f6fb0] dark:bg-[#3d7fbe]" : "border border-[#d7dce2] dark:border-[#3a4048] active:bg-[#f4f6f8] dark:bg-[#17191b]"}`}
                    >
                      <Text class={`text-[11px] ${themeMode() === mode() ? "text-white" : "text-[#191d24] dark:text-[#e7e9ec]"}`}>
                        {mode() === "system" ? "跟随系统" : mode() === "light" ? "亮色" : "暗色"}
                      </Text>
                    </Button>
                  )}
                </Each>
              </View>
              <View class="h-px bg-[#e3e7ec] dark:bg-[#2b3036]" />
              <Text class="text-[13px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">平台插件</Text>
              <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">同一时间只启用一个平台插件；切换后另一个平台的登录与自动同步会停用。</Text>
              <View class="gap-1">
                <Each of={PLUGINS} key={(p: any) => p.id}>
                  {(item: any) => (
                    <View class={`flex-row items-center gap-2 rounded-[6px] border px-3 py-2 ${config().active_plugin === item().id ? "border-[#2f6fb0] dark:border-[#4a8bc9] bg-[#eef4fb] dark:bg-[#1b2a39]" : "border-[#e3e7ec] dark:border-[#2b3036]"}`}>
                      <View class={`h-3 w-3 rounded-full border ${config().active_plugin === item().id ? "border-[#2f6fb0] dark:border-[#4a8bc9] bg-[#2f6fb0] dark:bg-[#3d7fbe]" : "border-[#c2c8d0] dark:border-[#4a515a]"}`} />
                      <View class="flex-1">
                        <Text class="text-[13px] text-[#191d24] dark:text-[#e7e9ec]">{item().name}</Text>
                        <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">{item().version} · {item().note}</Text>
                      </View>
                      <Button
                        onPress={() => patch({ active_plugin: item().id })}
                        class={`rounded-[6px] px-3 py-1 ${config().active_plugin === item().id ? "bg-[#2f6fb0] dark:bg-[#3d7fbe]" : "border border-[#d7dce2] dark:border-[#3a4048] active:bg-[#f4f6f8] dark:bg-[#17191b]"}`}
                      >
                        <Text class={`text-[12px] ${config().active_plugin === item().id ? "text-white" : "text-[#191d24] dark:text-[#e7e9ec]"}`}>
                          {config().active_plugin === item().id ? "已启用" : "启用"}
                        </Text>
                      </Button>
                    </View>
                  )}
                </Each>
              </View>

              <View class="h-px bg-[#e3e7ec] dark:bg-[#2b3036]" />
              <If when={config().active_plugin === "kugou"}>
                <Text class="text-[13px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">管理酷狗音乐</Text>
                <If when={!kugou()}>
                  <View class="gap-2">
                    <Button onPress={startLogin} class="self-start rounded-[6px] bg-[#2f6fb0] dark:bg-[#3d7fbe] px-3 py-2 active:opacity-80">
                      <Text class="text-[12px] text-white">生成登录二维码 / 刷新</Text>
                    </Button>
                    <If when={qr()}>
                      <Image src={qr()!.image} class="h-[160px] w-[160px] rounded-[6px] border border-[#e3e7ec] dark:border-[#2b3036]" />
                    </If>
                    <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">状态：{kgLabel()}</Text>
                    <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">{kgMsg()}</Text>
                  </View>
                </If>
                <If when={kugou()}>
                  <View class="gap-2">
                    <View class="flex-row items-center gap-2">
                      <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">已登录：{kugou()!.nickname ?? kugou()!.userid}</Text>
                      <View class="flex-1" />
                      <Button onPress={logout} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                        <Text class="text-[11px] text-[#191d24] dark:text-[#e7e9ec]">退出登录</Text>
                      </Button>
                    </View>

                    <View class="flex-row items-center gap-2">
                      <Text class="text-[12px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">目标歌单</Text>
                      <View class="flex-1" />
                      <Button onPress={() => loadLists()} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                        <Text class="text-[11px] text-[#191d24] dark:text-[#e7e9ec]">刷新</Text>
                      </Button>
                    </View>
                    <If when={lists().length === 0} else={
                      <View class="gap-1">
                        <Each of={lists()} key={(p: any) => p.listid}>
                          {(item: any) => (
                            <View class={`flex-row items-center gap-2 rounded-[6px] border px-2 py-1 ${config().target_playlist_id === item().listid ? "border-[#2f6fb0] dark:border-[#4a8bc9] bg-[#eef4fb] dark:bg-[#1b2a39]" : "border-[#e3e7ec] dark:border-[#2b3036]"}`}>
                              <Text class="flex-1 text-[12px] text-[#191d24] dark:text-[#e7e9ec]">{item().name}</Text>
                              <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">{item().count} 首</Text>
                              <Button
                                onPress={() => { patch({ target_playlist_id: item().listid, target_playlist_name: item().name }); log(`目标歌单: ${item().name}`); }}
                                class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]"
                              >
                                <Text class="text-[11px] text-[#191d24] dark:text-[#e7e9ec]">{config().target_playlist_id === item().listid ? "当前" : "设为目标"}</Text>
                              </Button>
                            </View>
                          )}
                        </Each>
                      </View>
                    }>
                      <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">暂无歌单，点“刷新”重试</Text>
                    </If>

                    <View class="flex-row items-center gap-2">
                      <Text class="text-[12px] text-[#59616e] dark:text-[#a9b1bd]">标记已点时自动加入歌单</Text>
                      <View class="flex-1" />
                      <Button onPress={() => patch({ auto_sync: !(config().auto_sync ?? false) })} class={`rounded-[6px] px-2 py-1 ${config().auto_sync ? "bg-[#2f6fb0] dark:bg-[#3d7fbe]" : "border border-[#d7dce2] dark:border-[#3a4048]"}`}>
                        <Text class={`text-[11px] ${config().auto_sync ? "text-white" : "text-[#191d24] dark:text-[#e7e9ec]"}`}>{config().auto_sync ? "开" : "关"}</Text>
                      </Button>
                    </View>

                    <Text class="text-[12px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">搜索并加入</Text>
                    <View class="flex-row gap-2">
                      <Input
                        value={kgQuery()}
                        onChange={({ value }) => kgQuery.set(value)}
                        onSubmit={doSearch}
                        placeholder="搜索酷狗歌曲"
                        class="min-w-0 flex-1 rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 text-[12px] text-[#191d24] dark:text-[#e7e9ec]"
                      />
                      <Button onPress={doSearch} class="rounded-[6px] bg-[#2f6fb0] dark:bg-[#3d7fbe] px-3 py-1 active:opacity-80">
                        <Text class="text-[12px] text-white">搜索</Text>
                      </Button>
                    </View>
                    <If when={kgResults().length === 0} else={
                      <View class="gap-1">
                        <Each of={kgResults()} key={(t: any) => t.hash}>
                          {(item: any) => (
                            <View class="flex-row items-center gap-2 border-b border-[#e3e7ec] dark:border-[#2b3036] px-1 py-1">
                              <View class="flex-1">
                                <Text class="text-[12px] text-[#191d24] dark:text-[#e7e9ec]">{item().name}</Text>
                                <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">{item().artist}</Text>
                              </View>
                              <Button onPress={() => addToPlaylist(item())} class="rounded-[6px] bg-[#2f6fb0] dark:bg-[#3d7fbe] px-2 py-1 active:opacity-80">
                                <Text class="text-[11px] text-white">加入歌单</Text>
                              </Button>
                              <Button onPress={() => addKugouToBoard(item())} class="rounded-[6px] border border-[#d7dce2] dark:border-[#3a4048] px-2 py-1 active:bg-[#f4f6f8] dark:bg-[#17191b]">
                                <Text class="text-[11px] text-[#191d24] dark:text-[#e7e9ec]">加入列表</Text>
                              </Button>
                            </View>
                          )}
                        </Each>
                      </View>
                    }>
                      <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">输入歌名后点“搜索”</Text>
                    </If>
                    <Text class="text-[11px] text-[#88919f] dark:text-[#7e8795]">{kgMsg()}</Text>
                  </View>
                </If>
              </If>
              <If when={config().active_plugin === "netease"}>
                <Text class="text-[13px] font-semibold text-[#191d24] dark:text-[#e7e9ec]">网易云音乐</Text>
                <Text class="text-[12px] text-[#88919f] dark:text-[#7e8795]">尚未接入。切换回酷狗即可继续管理歌单；同一时间只启用一个平台。</Text>
              </If>
            </View>
          </Scroll>
        </View>
      </Dialog>
    </View>
  );
}
mount(Board);
