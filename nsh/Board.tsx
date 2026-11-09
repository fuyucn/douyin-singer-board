import { Clipboard, colorScheme, effect, Image, mount, Scroll, setColorScheme, signal, Storage, Text, token, View } from "nsh";
import icon from "./assets/icon.png";
import logo from "./assets/logo.png";
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
  { key: "user", title: "用户", width: 120 },
  { key: "song", title: "点歌", width: 260 },
  { key: "time", title: "时间", width: 72 },
  { key: "actions", title: "", width: 110 },
];

const playedColumns: DataTableColumn[] = [
  { key: "idx", title: "#", width: 40, align: "end" },
  { key: "played", title: "时间", width: 80, align: "end" },
  { key: "user", title: "用户", width: 110 },
  { key: "song", title: "点歌", width: 260 },
  { key: "actions", title: "", width: 48 },
];

const ICON_PATHS: Record<string, string> = {
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};

function Icon(props: { name: string; class?: string; color?: string }) {
  const c = token((props.color ?? "muted-foreground") as any);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[props.name] ?? ""}</svg>`;
  return <Image src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} class={props.class ?? "h-4 w-4"} />;
}

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
  const playedQuery = signal("");
  const logOpen = signal(false);

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

  const filteredPlayed = () => {
    const q = playedQuery().trim().toLowerCase();
    if (!q) return played();
    return played().filter((s) => s.song_name.toLowerCase().includes(q) || s.uname.toLowerCase().includes(q));
  };

  const songRows = () =>
    songs().map((s, i) => ({
      idx: String(i + 1),
      user: s.uname || "?",
      song: s.song_name,
      time: clock(s.send_time),
      actions: "",
    }));

  const playedRows = () =>
    filteredPlayed().map((s, i) => ({
      idx: String(i + 1),
      user: s.uname || "?",
      song: s.song_name,
      played: clock(s.played_at),
      actions: "",
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
      class={`rounded-[6px] px-3 py-1 ${activeTab() === key ? "bg-primary" : "border border-line-strong active:bg-background"}`}
    >
      <Text class={`text-[12px] ${activeTab() === key ? "text-primary-foreground" : "text-foreground"}`}>{label}</Text>
    </Button>
  );

  return (
    <View class="flex-1 flex-col bg-background">
      <View class="h-[52px] shrink-0 flex-row items-center gap-3 border-b border-line bg-card px-4">
        <Image src={logo} class="h-10 w-10 rounded-[4px]" />
        <Text class="text-sm font-semibold whitespace-nowrap text-foreground">SUSUSongBoard</Text>
        <View class="flex-row items-center gap-[7px] rounded-[6px] border border-line bg-secondary px-[10px] py-[4px]">
          <View class={`h-[7px] w-[7px] rounded-full ${status() === "已连接" ? "bg-success" : running() ? "bg-[#fbbf24]" : "border border-line-strong"}`} />
          <Text class="text-[11px] whitespace-nowrap text-muted-foreground">
            {status() === "已连接" ? "已连接" : running() ? "连接中" : "未连接"}
          </Text>
        </View>
        <View class="flex-1" />
        <Button testID="theme" onPress={toggleTheme} class="h-[30px] w-[30px] rounded-(--radius) bg-transparent text-muted-foreground active:bg-muted">
          <Icon name={colorScheme() === "dark" ? "sun" : "moon"} class="h-[15px] w-[15px]" />
        </Button>
        <Button testID="settings" onPress={() => settingsOpen.set(true)} class="h-[30px] w-[30px] rounded-(--radius) bg-transparent text-muted-foreground active:bg-muted">
          <Icon name="settings" class="h-[15px] w-[15px]" />
        </Button>
        <If when={running()} else={
          <Button testID="start" onPress={start} class="ml-2 h-8 w-8 rounded-(--radius) bg-foreground">
            <Icon name="play" class="h-[15px] w-[15px]" color="background" />
          </Button>
        }>
          <Button testID="stop" onPress={stop} class="ml-2 h-8 w-8 rounded-(--radius) bg-destructive">
            <Icon name="square" class="h-[15px] w-[15px]" color="destructive-foreground" />
          </Button>
        </If>
      </View>

      <View class="flex-1 min-h-0 flex-row">
        <Scroll testID="sidebar" class="h-full w-72 shrink-0 border-r border-line bg-card">
          <View class="flex-col min-h-full">
            <View class="p-4">
              <Text class="mb-3 text-[13px] font-medium leading-5 text-foreground">直播间配置</Text>
              <View class="gap-3">
                <View class="gap-1.5">
                  <View class="flex-row items-center justify-between gap-2">
                    <Text class="text-xs text-muted-foreground">抖音直播间 ID</Text>
                    <If when={roomName()}>
                      <View class="inline-flex max-w-[60%] items-center gap-1">
                        <View class="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                        <Text class="truncate text-[11px] text-foreground">{roomName()}</Text>
                      </View>
                    </If>
                  </View>
                  <Input
                    value={config().room_id}
                    onChange={({ value }) => patch({ room_id: value })}
                    onSubmit={start}
                    placeholder="221321076494"
                    class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                </View>
                <View class="gap-1.5">
                  <View class="flex-row items-center gap-1">
                    <Text class="text-xs text-muted-foreground">点歌指令模板</Text>
                    <Icon name="info" class="h-3 w-3" color="faint" />
                  </View>
                  <Input
                    value={config().sing_prefix}
                    onChange={({ value }) => patch({ sing_prefix: value })}
                    placeholder="[song]"
                    class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                </View>
              </View>
            </View>

            <View class="h-px bg-line" />

            <View class="p-4">
              <Text class="mb-3 text-[13px] font-medium leading-5 text-foreground">点歌规则</Text>
              <View class="gap-3">
                <View class="flex-row gap-3">
                  <View class="flex-1 gap-1.5">
                    <Text class="text-xs text-muted-foreground">最低粉丝团等级</Text>
                    <Input
                      value={String(config().fans_level)}
                      onChange={({ value }) => patch({ fans_level: num(value) })}
                      class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                    />
                  </View>
                  <View class="flex-1 gap-1.5">
                    <Text class="text-xs text-muted-foreground">点歌冷却 (秒)</Text>
                    <Input
                      value={String(config().sing_cd)}
                      onChange={({ value }) => patch({ sing_cd: num(value) })}
                      class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                    />
                  </View>
                </View>
                <View class="gap-1.5">
                  <Text class="text-xs text-muted-foreground">重复点歌冷却 (秒)</Text>
                  <Input
                    value={String(config().cooldown_seconds)}
                    onChange={({ value }) => patch({ cooldown_seconds: num(value) })}
                    class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                  <Text class="text-[11px] text-faint">同一首歌在冷却时间内不会重复加入歌单</Text>
                </View>
                <View class="gap-1.5">
                  <Text class="text-xs text-muted-foreground">单人单场点歌上限</Text>
                  <Input
                    value={String(config().max_songs_per_user)}
                    onChange={({ value }) => patch({ max_songs_per_user: num(value) })}
                    class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                  <Text class="text-[11px] text-faint">每位观众本场最多自动点歌的首数（0 = 不限制）；手动加入不受限</Text>
                </View>
              </View>
            </View>

            <If when={config().active_plugin === "kugou" && kugou()}>
              <View class="h-px bg-line" />
              <View class="p-4">
                <Text class="mb-3 text-[13px] font-medium leading-5 text-foreground">Kugou 歌单</Text>
                <View class="gap-2">
                  <If when={kugou()}>
                    <View class="gap-2">
                      <View class="flex-row items-center justify-between gap-2">
                        <Text class="text-xs text-muted-foreground">歌单名称</Text>
                        <Text class="font-mono text-xs text-faint">id: {config().target_playlist_id || "—"}</Text>
                      </View>
                      <Input
                        value={config().target_playlist_name}
                        onChange={({ value }) => patch({ target_playlist_name: value })}
                        placeholder="自动加入歌单的名字"
                        class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                      />
                      <View class="flex-row gap-2">
                        <Button onPress={() => settingsOpen.set(true)} class="h-8 flex-1 rounded-(--radius) border border-line-strong bg-card px-2.5 active:bg-muted">
                          <Text class="text-xs text-foreground">管理酷狗</Text>
                        </Button>
                        <Button
                          onPress={() => patch({ auto_sync: !(config().auto_sync ?? false) })}
                          class={`h-8 flex-1 rounded-(--radius) px-2.5 ${config().auto_sync ? "bg-primary" : "border border-line-strong bg-card active:bg-muted"}`}
                        >
                          <Text class={`text-xs ${config().auto_sync ? "text-primary-foreground" : "text-foreground"}`}>
                            {config().auto_sync ? "同步中" : "自动同步"}
                          </Text>
                        </Button>
                      </View>
                    </View>
                  </If>
                </View>
              </View>
            </If>

            <View class="h-px bg-line" />

            <View class="p-4 pt-6">
              <Text class="mb-3 text-[13px] font-medium leading-5 text-foreground">手动点歌</Text>
              <View class="flex-row gap-2">
                <Input
                  value={manual()}
                  onChange={({ value }) => manual.set(value)}
                  onSubmit={addManual}
                  placeholder="输入歌曲名称..."
                  class="h-8 min-w-0 flex-1 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                />
                <Button onPress={addManual} class="h-8 shrink-0 rounded-(--radius) border border-line-strong bg-card px-2.5 active:bg-muted">
                  <Text class="text-sm text-foreground">添加</Text>
                </Button>
              </View>
            </View>

            <View class="mt-auto p-4 text-[11px] text-faint">
              <Text class="text-[11px] text-faint">SUSUSongBoard v0.5.2</Text>
            </View>
          </View>
        </Scroll>

        <View class="flex-1 flex-col min-h-0 bg-card">
          <View class="flex-row items-center justify-between border-b border-line px-3 py-1 shrink-0">
            <View class="flex-row items-center">
              <Button onPress={() => { activeTab.set("songs"); selectedRow.set(null); }} class={`h-9 items-center justify-center rounded-none border-0 border-b-2 bg-transparent px-3 ${activeTab() === "songs" ? "border-foreground" : "border-transparent"}`}>
                <Text class={`text-sm font-medium ${activeTab() === "songs" ? "text-foreground" : "text-muted-foreground"}`}>点歌列表 ({songs().length})</Text>
              </Button>
              <Button onPress={() => { activeTab.set("played"); selectedRow.set(null); }} class={`h-9 items-center justify-center rounded-none border-0 border-b-2 bg-transparent px-3 ${activeTab() === "played" ? "border-foreground" : "border-transparent"}`}>
                <Text class={`text-sm font-medium ${activeTab() === "played" ? "text-foreground" : "text-muted-foreground"}`}>已点歌单 ({played().length})</Text>
              </Button>
              <Button onPress={() => { activeTab.set("blacklist"); selectedRow.set(null); }} class={`h-9 items-center justify-center rounded-none border-0 border-b-2 bg-transparent px-3 ${activeTab() === "blacklist" ? "border-foreground" : "border-transparent"}`}>
                <Text class={`text-sm font-medium ${activeTab() === "blacklist" ? "text-foreground" : "text-muted-foreground"}`}>黑名单 ({bl().length})</Text>
              </Button>
            </View>
            <If when={activeTab() !== "blacklist" && (activeTab() === "songs" ? songs().length : played().length) > 0}>
              <Button
                onPress={() => { if (activeTab() === "songs") { songs.set([]); selectedRow.set(null); } else { played.set([]); } }}
                class="h-7 gap-1 rounded-(--radius) bg-transparent px-2.5 active:bg-muted"
              >
                <Icon name="trash" class="h-3.5 w-3.5" color="muted-foreground" />
                <Text class="text-xs text-muted-foreground">清空列表</Text>
              </Button>
            </If>
          </View>

          <View class="flex-1 min-h-0 flex-col">
            <If when={activeTab() === "songs"}>
              <If when={songs().length === 0} else={
                <DataTable
                  columns={songColumns}
                  data={songRows()}
                  rowHeight={48}
                  headerHeight={32}
                  class="flex-1"
                  classes={{ header: "bg-secondary border-b border-line", headerCell: "px-3 text-xs font-medium text-muted-foreground", cell: "px-2", row: "border-b border-line", rowHover: "bg-muted" }}
                  renderCell={(cell: any) => {
                    const song = songs()[cell.row];
                    if (!song) return <Text class="text-sm">{cell.text}</Text>;
                    if (cell.key === "idx") return <Text class="text-xs text-faint">{cell.row + 1}</Text>;
                    if (cell.key === "user") {
                      const max = config().max_songs_per_user;
                      const count = played().filter((p) => p.uid === song.uid).length;
                      const show = max > 0 && song.uid !== "manual";
                      return (
                        <View class="flex-row items-center gap-1">
                          <Text class="truncate text-xs text-muted-foreground">{song.uname}</Text>
                          <If when={show}>
                            <Text class={`shrink-0 rounded px-1 text-[10px] tabular-nums ${count >= max ? "bg-danger-soft-bg text-danger-soft-fg" : "bg-muted text-faint"}`}>{count}/{max}</Text>
                          </If>
                        </View>
                      );
                    }
                    if (cell.key === "song") {
                      const sub = config().active_plugin === "kugou" && kugou()
                        ? (config().target_playlist_id ? "待加入歌单" : "未选择歌单")
                        : "手动添加";
                      return (
                        <View class="leading-snug">
                          <Text class="truncate text-[13px] font-medium text-foreground">{song.song_name}</Text>
                          <Text class="truncate text-[11px] text-faint">{sub}</Text>
                        </View>
                      );
                    }
                    if (cell.key === "time") return <Text class="text-xs text-faint">{clock(song.send_time)}</Text>;
                    if (cell.key === "actions") {
                      return (
                        <View class="flex-row justify-end gap-1 opacity-60">
                          <Button onPress={() => { Clipboard.writeText(song.song_name); log(`已复制: ${song.song_name}`); }} class="h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted">
                            <Icon name="copy" class="h-3.5 w-3.5" />
                          </Button>
                          <Button testID={`mark-${cell.row}`} onPress={() => markPlayed(cell.row)} class="h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted">
                            <Icon name="check" class="h-3.5 w-3.5" />
                          </Button>
                          <Button testID={`delete-${cell.row}`} onPress={() => removeSong(cell.row)} class="h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted">
                            <Icon name="trash" class="h-3.5 w-3.5" color="danger-soft-fg" />
                          </Button>
                        </View>
                      );
                    }
                    return <Text class="text-sm">{cell.text}</Text>;
                  }}
                  empty={<Text class="text-sm text-faint">等待点歌...</Text>}
                />
              }>
                <View class="flex-1 items-center justify-center gap-3 py-16">
                  <View class="items-center">
                    <Text class="text-sm font-medium text-muted-foreground">{running() ? "等待点歌..." : "当前点歌列表为空"}</Text>
                    <Text class="mt-1 text-xs text-faint">{running() ? "正在监听直播间弹幕" : "观众点歌后会显示在这里"}</Text>
                  </View>
                </View>
              </If>
            </If>

            <If when={activeTab() === "played"}>
              <If when={played().length > 0}>
                <View class="shrink-0 border-b border-line px-3 py-1.5">
                  <View class="h-7 flex-row items-center gap-2 rounded-(--radius) border border-input bg-background px-2">
                    <Icon name="search" class="h-3.5 w-3.5" color="faint" />
                    <Input
                      value={playedQuery()}
                      onChange={({ value }) => playedQuery.set(value)}
                      placeholder="搜索歌曲名或用户…"
                      class="h-6 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs"
                    />
                    <If when={playedQuery()}>
                      <Button onPress={() => playedQuery.set("")} class="h-6 w-6 rounded-(--radius) bg-transparent active:bg-muted">
                        <Icon name="x" class="h-3.5 w-3.5" color="faint" />
                      </Button>
                    </If>
                  </View>
                </View>
              </If>
              <DataTable
                columns={playedColumns}
                data={playedRows()}
                rowHeight={48}
                headerHeight={32}
                class="flex-1"
                classes={{ header: "bg-secondary border-b border-line", headerCell: "px-3 text-xs font-medium text-muted-foreground", cell: "px-2", row: "border-b border-line", rowHover: "bg-muted" }}
                renderCell={(cell: any) => {
                  const song = filteredPlayed()[cell.row];
                  if (!song) return <Text class="text-sm">{cell.text}</Text>;
                  if (cell.key === "idx") return <Text class="text-xs text-faint">{cell.row + 1}</Text>;
                  if (cell.key === "played") return <Text class="text-xs text-faint">{clock(song.played_at)}</Text>;
                  if (cell.key === "user") return <Text class="truncate text-xs text-muted-foreground">{song.uname}</Text>;
                  if (cell.key === "song") return (
                    <View class="leading-snug">
                      <Text class="truncate text-[13px] font-medium text-foreground">{song.song_name}</Text>
                      <Text class="truncate text-[11px] text-faint">已点</Text>
                    </View>
                  );
                  if (cell.key === "actions") return (
                    <View class="flex-row justify-end">
                      <Button onPress={() => { Clipboard.writeText(song.song_name); log(`已复制: ${song.song_name}`); }} class="h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted">
                        <Icon name="copy" class="h-3.5 w-3.5" />
                      </Button>
                    </View>
                  );
                  return <Text class="text-sm">{cell.text}</Text>;
                }}
                empty={<Text class="text-sm text-faint">{playedQuery() ? "没有匹配的歌曲" : "暂无已点歌曲"}</Text>}
              />
            </If>

            <If when={activeTab() === "blacklist"}>
              <View class="flex-1 flex-col min-h-0">
                <View class="flex-row items-center gap-2 border-b border-line bg-card px-3 py-2 shrink-0">
                  <Input
                    value={blackInput()}
                    onChange={({ value }) => blackInput.set(value)}
                    onSubmit={addBlack}
                    placeholder="输入歌曲名…"
                    class="h-8 min-w-0 flex-1 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                  <Button testID="black-add" onPress={addBlack} class="h-8 w-8 rounded-(--radius) border border-line-strong bg-card active:bg-muted">
                    <Icon name="plus" class="h-4 w-4" />
                  </Button>
                </View>
                <If when={bl().length === 0} else={
                  <View class="flex-1 flex-col min-h-0">
                    <View class="flex-row items-center border-b border-line bg-secondary px-4 py-2 shrink-0">
                      <Text class="w-12 text-xs font-medium text-muted-foreground">类型</Text>
                      <Text class="flex-1 text-xs font-medium text-muted-foreground">歌曲名</Text>
                      <Text class="w-28 text-xs font-medium text-muted-foreground">歌手</Text>
                      <Text class="w-24 text-right text-xs font-medium text-muted-foreground">添加时间</Text>
                      <View class="w-10" />
                    </View>
                    <Scroll class="flex-1">
                      <Each of={bl()} key={(s: string) => s}>
                        {(item: any, index: any) => (
                          <View class="group flex-row items-center border-b border-line px-4 py-2 hover:bg-muted">
                            <View class="w-12">
                              <Text class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">歌曲</Text>
                            </View>
                            <Text class="flex-1 truncate text-sm text-foreground">{item()}</Text>
                            <Text class="w-28 truncate text-xs text-muted-foreground">—</Text>
                            <Text class="w-24 text-right text-xs text-faint">—</Text>
                            <View class="w-10 items-end">
                              <Button testID={`black-remove-${index()}`} onPress={() => removeBlack(item())} class="h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted">
                                <Icon name="x" class="h-3.5 w-3.5" color="danger-soft-fg" />
                              </Button>
                            </View>
                          </View>
                        )}
                      </Each>
                    </Scroll>
                  </View>
                }>
                  <View class="flex-1 items-center justify-center gap-2 py-16">
                    <Text class="text-sm text-faint">黑名单为空</Text>
                    <Text class="text-xs text-faint">在上方输入歌曲名添加</Text>
                  </View>
                </If>
              </View>
            </If>
          </View>

          <If when={logs().length > 0}>
            <View class="shrink-0 border-t border-line bg-card">
              <View class="flex-row items-center bg-secondary px-3 py-[6px]">
                <Button onPress={() => logOpen.update((v) => !v)} class="flex-1 flex-row items-center gap-2 bg-transparent p-0 active:bg-transparent">
                  <Text class="text-[12px] font-medium text-muted-foreground">日志</Text>
                  <Text class="ml-1 rounded bg-muted px-1.5 font-mono text-[10px] text-faint">{logs().length}</Text>
                </Button>
                <Button onPress={() => { Clipboard.writeText(logs().join("\n")); log("日志已复制"); }} class="h-6 flex-row items-center gap-1 rounded px-1.5 bg-transparent active:bg-muted">
                  <Icon name="copy" class="h-3 w-3" color="faint" />
                  <Text class="text-[11px] text-faint">复制</Text>
                </Button>
                <Button onPress={() => logs.set([])} class="h-6 flex-row items-center gap-1 rounded px-1.5 bg-transparent active:bg-danger-soft-bg">
                  <Icon name="trash" class="h-3 w-3" color="faint" />
                  <Text class="text-[11px] text-faint">清空</Text>
                </Button>
                <Button onPress={() => logOpen.update((v) => !v)} class="ml-1 h-6 w-6 rounded bg-transparent active:bg-muted">
                  <Icon name="chevron" class={`h-3.5 w-3.5 ${logOpen() ? "rotate-180" : ""}`} color="faint" />
                </Button>
              </View>
              <If when={logOpen()}>
                <Scroll class="max-h-[220px] bg-background">
                  <Each of={logs()} key="index">
                    {(line: any) => (
                      <View class="flex-row items-baseline border-b border-line px-3 py-1 hover:bg-muted">
                        <Text class="w-[58px] shrink-0 text-right font-mono text-[10px] leading-none text-faint">{String(line()).slice(0, 8)}</Text>
                        <Text class="flex-1 pl-2 text-[11px] leading-relaxed text-muted-foreground">{String(line()).slice(8)}</Text>
                      </View>
                    )}
                  </Each>
                </Scroll>
              </If>
            </View>
          </If>
        </View>
      </View>

      <View class="flex-row items-center gap-4 border-t border-line px-5 py-1.5 text-xs shrink-0">
        <If when={songs().length + played().length > 0 || running()}>
          <View class="flex-row items-center gap-4">
            <View class="inline-flex items-baseline gap-1"><Text class="text-faint">队列</Text><Text class="tabular-nums text-foreground">{songs().length}</Text></View>
            <View class="inline-flex items-baseline gap-1"><Text class="text-faint">已播</Text><Text class="tabular-nums text-foreground">{played().length}</Text></View>
            <View class="inline-flex items-baseline gap-1"><Text class="text-faint">总数</Text><Text class="tabular-nums text-foreground">{songs().length + played().length}</Text></View>
            <If when={played().length > 0}>
              <View class="inline-flex items-baseline gap-1"><Text class="text-faint">平均处理</Text><Text class="tabular-nums text-foreground">{(played().reduce((sum, p) => sum + Math.max(0, p.played_at - p.send_time), 0) / played().length).toFixed(0)}秒</Text></View>
            </If>
          </View>
        </If>
        <View class="ml-auto flex-row items-center gap-4">
          <View class="flex-row items-center gap-1">
            <If when={status() === "已连接"} else={<View class="h-2 w-2 rounded-full bg-faint" />}>
              <Text class="text-[11px] text-success">✓</Text>
            </If>
            <Text class="text-[11px] text-faint">连接抖音直播间</Text>
          </View>
          <View class="flex-row items-center gap-1">
            <If when={config().active_plugin === "kugou" && kugou()} else={<View class="h-2 w-2 rounded-full bg-faint" />}>
              <Text class="text-[11px] text-success">✓</Text>
            </If>
            <Text class="text-[11px] text-faint">酷狗服务就绪</Text>
          </View>
        </View>
      </View>

      <Dialog
        open={settingsOpen()}
        onOpenChange={({ open }: any) => settingsOpen.set(open)}
        class="m-auto w-[560px] rounded-(--radius) border border-line bg-card shadow-2xl"
        backdropClass="bg-overlay"
      >
        <View class="h-[620px]">
          <View class="h-[48px] flex-row items-center border-b border-line px-4">
            <Text class="text-[14px] font-semibold text-foreground">设置</Text>
            <View class="flex-1" />
            <Button onPress={() => settingsOpen.set(false)} class="rounded-[6px] border border-line-strong px-3 py-1 active:bg-background">
              <Text class="text-[12px] text-foreground">关闭</Text>
            </Button>
          </View>
          <Scroll class="flex-1 p-4">
            <View class="gap-3">
              <Text class="text-[13px] font-semibold text-foreground">外观</Text>
              <View class="flex-row gap-2">
                <Each of={(["system", "light", "dark"] as const)} key={(m: any) => m}>
                  {(mode: any) => (
                    <Button
                      onPress={() => applyTheme(mode())}
                      class={`rounded-[6px] px-3 py-1 ${themeMode() === mode() ? "bg-primary" : "border border-line-strong active:bg-background"}`}
                    >
                      <Text class={`text-[11px] ${themeMode() === mode() ? "text-primary-foreground" : "text-foreground"}`}>
                        {mode() === "system" ? "跟随系统" : mode() === "light" ? "亮色" : "暗色"}
                      </Text>
                    </Button>
                  )}
                </Each>
              </View>
              <View class="h-px bg-muted" />
              <Text class="text-[13px] font-semibold text-foreground">平台插件</Text>
              <Text class="text-[11px] text-faint">同一时间只启用一个平台插件；切换后另一个平台的登录与自动同步会停用。</Text>
              <View class="gap-1">
                <Each of={PLUGINS} key={(p: any) => p.id}>
                  {(item: any) => (
                    <View class={`flex-row items-center gap-2 rounded-[6px] border px-3 py-2 ${config().active_plugin === item().id ? "border-primary bg-accent-soft-bg" : "border-line"}`}>
                      <View class={`h-3 w-3 rounded-full border ${config().active_plugin === item().id ? "border-primary bg-primary" : "border-line-strong"}`} />
                      <View class="flex-1">
                        <Text class="text-[13px] text-foreground">{item().name}</Text>
                        <Text class="text-[11px] text-faint">{item().version} · {item().note}</Text>
                      </View>
                      <Button
                        onPress={() => patch({ active_plugin: item().id })}
                        class={`rounded-[6px] px-3 py-1 ${config().active_plugin === item().id ? "bg-primary" : "border border-line-strong active:bg-background"}`}
                      >
                        <Text class={`text-[12px] ${config().active_plugin === item().id ? "text-primary-foreground" : "text-foreground"}`}>
                          {config().active_plugin === item().id ? "已启用" : "启用"}
                        </Text>
                      </Button>
                    </View>
                  )}
                </Each>
              </View>

              <View class="h-px bg-muted" />
              <If when={config().active_plugin === "kugou"}>
                <Text class="text-[13px] font-semibold text-foreground">管理酷狗音乐</Text>
                <If when={!kugou()}>
                  <View class="gap-2">
                    <Button onPress={startLogin} class="self-start rounded-[6px] bg-primary px-3 py-2 active:opacity-80">
                      <Text class="text-[12px] text-primary-foreground">生成登录二维码 / 刷新</Text>
                    </Button>
                    <If when={qr()}>
                      <Image src={qr()!.image} class="h-[160px] w-[160px] rounded-[6px] border border-line" />
                    </If>
                    <Text class="text-[12px] text-muted-foreground">状态：{kgLabel()}</Text>
                    <Text class="text-[11px] text-faint">{kgMsg()}</Text>
                  </View>
                </If>
                <If when={kugou()}>
                  <View class="gap-2">
                    <View class="flex-row items-center gap-2">
                      <Text class="text-[12px] text-muted-foreground">已登录：{kugou()!.nickname ?? kugou()!.userid}</Text>
                      <View class="flex-1" />
                      <Button onPress={logout} class="rounded-[6px] border border-line-strong px-2 py-1 active:bg-background">
                        <Text class="text-[11px] text-foreground">退出登录</Text>
                      </Button>
                    </View>

                    <View class="flex-row items-center gap-2">
                      <Text class="text-[12px] font-semibold text-foreground">目标歌单</Text>
                      <View class="flex-1" />
                      <Button onPress={() => loadLists()} class="rounded-[6px] border border-line-strong px-2 py-1 active:bg-background">
                        <Text class="text-[11px] text-foreground">刷新</Text>
                      </Button>
                    </View>
                    <If when={lists().length === 0} else={
                      <View class="gap-1">
                        <Each of={lists()} key={(p: any) => p.listid}>
                          {(item: any) => (
                            <View class={`flex-row items-center gap-2 rounded-[6px] border px-2 py-1 ${config().target_playlist_id === item().listid ? "border-primary bg-accent-soft-bg" : "border-line"}`}>
                              <Text class="flex-1 text-[12px] text-foreground">{item().name}</Text>
                              <Text class="text-[11px] text-faint">{item().count} 首</Text>
                              <Button
                                onPress={() => { patch({ target_playlist_id: item().listid, target_playlist_name: item().name }); log(`目标歌单: ${item().name}`); }}
                                class="rounded-[6px] border border-line-strong px-2 py-1 active:bg-background"
                              >
                                <Text class="text-[11px] text-foreground">{config().target_playlist_id === item().listid ? "当前" : "设为目标"}</Text>
                              </Button>
                            </View>
                          )}
                        </Each>
                      </View>
                    }>
                      <Text class="text-[11px] text-faint">暂无歌单，点“刷新”重试</Text>
                    </If>

                    <View class="flex-row items-center gap-2">
                      <Text class="text-[12px] text-muted-foreground">标记已点时自动加入歌单</Text>
                      <View class="flex-1" />
                      <Button onPress={() => patch({ auto_sync: !(config().auto_sync ?? false) })} class={`rounded-[6px] px-2 py-1 ${config().auto_sync ? "bg-primary" : "border border-line-strong"}`}>
                        <Text class={`text-[11px] ${config().auto_sync ? "text-primary-foreground" : "text-foreground"}`}>{config().auto_sync ? "开" : "关"}</Text>
                      </Button>
                    </View>

                    <Text class="text-[12px] font-semibold text-foreground">搜索并加入</Text>
                    <View class="flex-row gap-2">
                      <Input
                        value={kgQuery()}
                        onChange={({ value }) => kgQuery.set(value)}
                        onSubmit={doSearch}
                        placeholder="搜索酷狗歌曲"
                        class="min-w-0 flex-1 rounded-[6px] border border-line-strong px-2 py-1 text-[12px] text-foreground"
                      />
                      <Button onPress={doSearch} class="rounded-[6px] bg-primary px-3 py-1 active:opacity-80">
                        <Text class="text-[12px] text-primary-foreground">搜索</Text>
                      </Button>
                    </View>
                    <If when={kgResults().length === 0} else={
                      <View class="gap-1">
                        <Each of={kgResults()} key={(t: any) => t.hash}>
                          {(item: any) => (
                            <View class="flex-row items-center gap-2 border-b border-line px-1 py-1">
                              <View class="flex-1">
                                <Text class="text-[12px] text-foreground">{item().name}</Text>
                                <Text class="text-[11px] text-faint">{item().artist}</Text>
                              </View>
                              <Button onPress={() => addToPlaylist(item())} class="rounded-[6px] bg-primary px-2 py-1 active:opacity-80">
                                <Text class="text-[11px] text-primary-foreground">加入歌单</Text>
                              </Button>
                              <Button onPress={() => addKugouToBoard(item())} class="rounded-[6px] border border-line-strong px-2 py-1 active:bg-background">
                                <Text class="text-[11px] text-foreground">加入列表</Text>
                              </Button>
                            </View>
                          )}
                        </Each>
                      </View>
                    }>
                      <Text class="text-[11px] text-faint">输入歌名后点“搜索”</Text>
                    </If>
                    <Text class="text-[11px] text-faint">{kgMsg()}</Text>
                  </View>
                </If>
              </If>
              <If when={config().active_plugin === "netease"}>
                <Text class="text-[13px] font-semibold text-foreground">网易云音乐</Text>
                <Text class="text-[12px] text-faint">尚未接入。切换回酷狗即可继续管理歌单；同一时间只启用一个平台。</Text>
              </If>
            </View>
          </Scroll>
        </View>
      </Dialog>
    </View>
  );
}
mount(Board);
