import { Clipboard, colorScheme, createMotion, effect, host, Image, mount, openUrl, Overlay, Scroll, setColorScheme, signal, Text, token, View } from "nsh";
import { Icon, IconButton, PALETTE } from "./ui";
import icon from "./assets/icon.png";
import logo from "./assets/logo.png";
import { Button, Dialog, Input, Toast, ToastManager, ToastStack, Tooltip } from "nsh/base";
import { Menu } from "nsh/desktop";
import { checkForUpdate, downloadUpdate, installAndRestart } from "nsh/updater";
import Client from "./listener-bundle.js";
import { Matcher } from "./src/matcher";
import { SyncLedger, formatDuration, isAuthFailure, nextDelay, pickNextSync, type SearchState } from "./src/autoSync";
import { DEFAULT_SING_PREFIX, type Config, type DanmuInfo } from "./src/types";
import type { Playlist, Track } from "./src/types";
// Registering the platforms is what `PLUGINS` and `pluginEnabled()` read: a
// new platform is one more import here plus its own folder under `plugins/`.
import "./src/platform/kugou";
import "./plugins/netease/platform";
import { hasPlaylists, platform, platforms } from "./src/platform/registry";
import process from "process";
import { createSqliteStore } from "./src/sqliteStore";
// The plugin channel: a plugin is a folder under ${dataDir}/plugins that the
// app runs in a hidden web view (see src/plugin/). Nothing here is on the path
// of the built-in platforms.
import { PluginChannel } from "./src/plugin/bridge";
import { DEMO_PLUGIN, DEMO_SOURCE } from "./src/plugin/demo";
import { KUGOU_WEB_FILES, KUGOU_WEB_MANIFEST } from "./src/plugin/kugouPlugin";
import { PluginView } from "./src/plugin/PluginView";
import { installPlugin, listPlugins, pluginsDir, removePlugin } from "./src/plugin/store";
import type { InstalledPlugin } from "./src/plugin/types";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** Next.js streams the room page as escaped JSON: `nickname\":\"…`.
 *  Reading it by index keeps the backslashes out of RegExp sources, where
 *  a mis-escaped class silently throws and the preview never appears. */
function parseRoomInfo(html: string): { nickname: string; title: string; status: number } | null {
  const text = (key: string) => {
    const prefix = key + '\\":\\"';
    const at = html.indexOf(prefix);
    if (at < 0) return "";
    let value = "";
    for (let i = at + prefix.length; i < html.length; i++) {
      const ch = html[i];
      if (ch === '"' || ch === "\\") break;
      value += ch;
    }
    return value.startsWith("$") ? "" : value;
  };
  const number = (key: string) => {
    const prefix = key + '\\":';
    const at = html.indexOf(prefix);
    if (at < 0) return 0;
    let digits = "";
    for (let i = at + prefix.length; i < html.length; i++) {
      const ch = html[i];
      if (ch < "0" || ch > "9") break;
      digits += ch;
    }
    return Number(digits || 0);
  };
  const nickname = text("nickname");
  if (!nickname) return null;
  return { nickname, title: text("title"), status: number("status") };
}
const APP_VERSION = "0.43.0-preview.6";
const APP_REPO = "fuyucn/douyin-singer-board";

type Tab = "songs" | "played" | "blacklist";
type PluginId = string;
const PLUGINS = platforms();
type KugouSession = { token: string; userid: string; dfid?: string; nickname?: string };
type PlayedInfo = DanmuInfo & { played_at: number };

// Column widths below mirror the original's TanStack table: #40 / 用户120 /
// 点歌 grow / 时间72 / actions110 (played: #40 / 时间80 / 用户110 / 点歌 grow /
// actions48). Rows are real views, not DataTable slots, so inline buttons
// receive presses on a real renderer.
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const dateStamp = (ts: number) => {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// The original CSS spins `.auto-sync-btn::before` (a conic-gradient ring) and
// its RefreshCw icon 2s/linear forever; the pending ListPlus button uses the
// same loop for its loader. NSH has no pseudo-elements, so real views draw the
// ring and one shared motion spins them. Module-level: re-rendering must not
// restart or stack the loop.
const spinMotion = createMotion();
spinMotion.play({
  keyframes: { rotate: [0, 360] },
  duration: 2000,
  easing: "linear",
  iterations: "infinite",
  ignoreReduceMotion: true,
});

function Board() {
  // Test launch parameters are explicit; normal app launches have none.
  const testSeed = host.params.sqliteTestSeed as Record<string, string> | undefined;
  // Tests can point the store at a temporary directory to exercise a real
  // file across an app restart; production always uses process.dataDir.
  const testDir = host.params.sqliteTestDir as string | undefined;
  const storage = createSqliteStore(testDir ?? process.dataDir, testSeed);
  // Plugins live beside the database; a test may point both at a temp dir.
  const dataDir = () => testDir ?? process.dataDir;
  const config = signal<Config>({
    room_id: "145997388006",
    sing_prefix: DEFAULT_SING_PREFIX,
    fans_level: 0,
    sing_cd: 0,
    cooldown_seconds: 1800,
    max_songs_per_user: 3,
    target_playlist_name: "",
    target_playlist_id: 0,
    kugou_enabled: true,
    blacklist: [],
    blacklist_singers: [],
    blacklist_meta: {},
    auto_sync: false,
    active_plugin: "kugou-web",
  });
  const status = signal("未连接");
  // Preview of the room's streamer (nickname/title/live status), fetched as
  // the ID changes and refreshed on connect.
  const roomInfo = signal<{ nickname: string; title: string; status: number } | null>(null);
  const songs = signal<DanmuInfo[]>([]);
  const played = signal<PlayedInfo[]>([]);
  const logs = signal<string[]>([]);
  const manual = signal("");
  const blackInput = signal("");
  const activeTab = signal<Tab>("songs");
  const settingsOpen = signal(false);
  const settingsTab = signal<"general" | "plugin" | "about">("general");
  const openSettings = (tab: "general" | "plugin" | "about" = "general") => {
    settingsTab.set(tab);
    settingsOpen.set(true);
  };
  const themeMode = signal<"system" | "light" | "dark">("system");
  const playedQuery = signal("");
  const logOpen = signal(false);
  // The log panel is opt-in: hidden until the user turns it on, and the
  // choice is kept in SQLite (settings), not in board.config.
  const logVisible = signal(false);
  const clearConfirm = signal<Tab | null>(null);
  let clearTimer: number | null = null;

  const kugou = signal<KugouSession | null>(null);
  const kgState = signal("idle");
  const qr = signal<{ key: string; image: string } | null>(null);
  const lists = signal<Playlist[]>([]);
  const kgMsg = signal("");
  const kgCache = signal<Record<string, SearchState>>({});
  const blackType = signal<"song" | "singer">("song");
  const aboutMsg = signal("");
  const aboutBusy = signal(false);
  const updateInfo = signal<any>(null);
  const updateProgress = signal<number | null>(null);
  const nowTick = signal(Math.floor(Date.now() / 1000));
  let loginGen = 0;

  const matcher = new Matcher(config());
  effect(() => matcher.reload(config()));

  const configLoaded = signal(false);
  const showFirstRunImport = signal(false);

  // SQLite opens and migrates before any read or write. A failed startup
  // leaves configLoaded false, preventing defaults from overwriting old data.
  effect(() => {
    void (async () => {
      let raw: string | null = null;
      try {
        raw = await storage.getItem("board.config");
        if (raw) applySavedConfig(raw);
        const theme = await storage.getItem("board.theme");
        if (theme === "light" || theme === "dark" || theme === "system") {
          themeMode.set(theme);
          setColorScheme(theme);
        }
        logVisible.set((await storage.getItem("board.log_visible")) === "1");
        configLoaded.set(true);
        restoreSession();
      } catch (e: any) {
        log("SQLite initialization failed: " + String(e?.message ?? e));
        showFlash("SQLite 初始化失败，旧数据未覆盖，请检查后重启");
      }
    })();
  });

  // A valid room ID previews its streamer without connecting (the Tauri app
  // did the same with a 600 ms debounce). Failures stay silent.
  effect(() => {
    const rid = config().room_id.trim();
    roomInfo.set(null);
    if (!/^\d{6,}$/.test(rid)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const html = await (await fetch(`https://live.douyin.com/${rid}`, { headers: { "User-Agent": UA } })).text();
        if (cancelled) return;
        const info = parseRoomInfo(html);
        if (info) roomInfo.set(info);
      } catch {
        /* silent: the label simply stays empty */
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  // Show first-run dialog only after config loading completes and no config was found.
  effect(() => {
    if (configLoaded() && !config().room_id) {
      showFirstRunImport.set(true);
    }
  });

  function applySavedConfig(raw: string) {
    try {
      const saved = JSON.parse(raw);
      const legacy = saved.config_version !== 2;
      // 0.5.x stored kugou_enabled=false as a default even though the
      // flag was not wired up: upgrade those configs to the Kugou
      // platform. From v2 on, an explicitly disabled service means
      // "no platform selected" — the user may leave every platform off.
      const rawActive = saved.active_plugin === "kugou" ? "kugou-web" : saved.active_plugin;
      const active = legacy
        ? (rawActive === "netease" || rawActive === "" ? rawActive : "kugou-web")
        : (typeof rawActive === "string"
            // "" and any registered id are kept as they are, and so is an id
            // whose platform is not here (a removed plugin): the registry
            // decides what applies, so nothing is silently renamed to kugou.
            ? rawActive
            : saved.kugou_enabled === false ? "" : "kugou-web");
      config.set({
        ...config(),
        ...saved,
        active_plugin: active,
        kugou_enabled: active === "kugou-web",
        blacklist: Array.isArray(saved.blacklist) ? saved.blacklist : [],
        blacklist_singers: Array.isArray(saved.blacklist_singers) ? saved.blacklist_singers : [],
        blacklist_meta: saved.blacklist_meta && typeof saved.blacklist_meta === "object" ? saved.blacklist_meta : {},
        config_version: 2,
      });
      if (active !== "kugou-web") patch({ auto_sync: false });
    } catch {}
  }
  effect(() => {
    if (!configLoaded()) return;
    storage.setItem("board.config", JSON.stringify(config())).catch(storageError);
  });

  const applyTheme = (mode: "system" | "light" | "dark") => {
    themeMode.set(mode);
    setColorScheme(mode);
    storage.setItem("board.theme", mode).catch(storageError);
  };

  function storageError(e: any) {
    log("SQLite persistence failed: " + String(e?.message ?? e));
    showFlash("SQLite 保存失败，请检查日志");
  }

  const toggleTheme = () => {
    applyTheme(colorScheme() === "dark" ? "light" : "dark");
  };

  const setLogVisible = (on: boolean) => {
    logVisible.set(on);
    storage.setItem("board.log_visible", on ? "1" : "0").catch(storageError);
  };

  const saveSession = (sess: KugouSession) => {
    kugou.set(sess);
    storage.setItem("kugou.session", JSON.stringify(sess)).catch(storageError);
  };

  const loadLists = async (sess: KugouSession | null = kugou()) => {
    if (!pluginEnabled() || !sess) return;
    try {
      const arr = await fetchPlaylists(sess.token, sess.userid, sess.dfid ?? "-");
      lists.set(arr);
      // Do NOT overwrite target_playlist_id/name here: the name is editable
      // and is resolved with "using exist or create" elsewhere. Picking
      // arr[0] silently undid the user's edit and could point auto-sync at an
      // unrelated playlist.
      kgState.set("ok");
      kgMsg.set("");
    } catch (e: any) {
      const auth = isAuthFailure({ status: 0 }, String(e?.message ?? e));
      kgState.set(auth ? "expired" : "error");
      kgMsg.set(auth ? "酷狗登录已失效，请重新扫码" : "歌单加载失败: " + String(e?.message ?? e));
      showFlash(auth ? "酷狗登录已失效" : "歌单加载失败");
      log(auth ? "酷狗登录已失效" : "酷狗歌单加载失败");
    }
  };

  // Session restore is deferred until config has decided the active platform:
  // with no platform selected, do not activate a Kugou session or call
  // get_all_list (which could otherwise raise a stale-token warning).
  function restoreSession() {
    if (!pluginEnabled()) return;
    storage.getItem("kugou.session")
      .then((raw) => {
        if (!raw || !pluginEnabled()) return;
        try {
          const sess = JSON.parse(raw) as KugouSession;
          if (sess?.token && sess?.userid) {
            kugou.set(sess);
            loadLists(sess);
          }
        } catch {}
      })
      .catch(storageError);
  }

  const pollQr = async (key: string, gen: number) => {
    if (gen !== loginGen || !pluginEnabled()) return;
    try {
      const r = await qrCheck(key);
      if (gen !== loginGen || !pluginEnabled()) return;
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
    kgState.set("idle");
    kgMsg.set("");
    storage.removeItem("kugou.session").catch(storageError);
    log("酷狗已退出登录");
    showFlash("酷狗已退出登录");
  };

  let client: any = null;
  let generation = 0;

  const log = (line: string) => {
    const t = clock(Math.floor(Date.now() / 1000));
    logs.update((v) => [...v.slice(-120), `${t} ${line}`]);
  };


  // The platform is the plugin: every KuGou call below goes to its page.
  const KUGOU_PLUGIN_ID = KUGOU_WEB_MANIFEST.id;

  const waitReady = async (ms: number) => {
    const plugin = plugins().find((p) => p.manifest.id === KUGOU_PLUGIN_ID);
    if (!plugin) throw new Error("插件未安装");
    const channel = channelFor(plugin);
    if (channel.ready) return channel;
    await channel.waitForReady(ms);
    return channel;
  };

  async function search(input: { keyword: string; page?: number; pagesize?: number }): Promise<Track[]> {
    await waitReady(4000);
    const tracks = await kwCall("search", input);
    return tracks as Track[];
  }

  async function fetchPlaylists(token: string, userid: string, dfid = "-"): Promise<Playlist[]> {
    await waitReady(4000);
    return (await kwCall("playlists", { token, userid, dfid })) as Playlist[];
  }

  async function qrKey(): Promise<{ key: string; image: string }> {
    await waitReady(4000);
    return (await kwCall("loginQrKey", {})) as { key: string; image: string };
  }

  async function qrCheck(key: string): Promise<{ status: number; token?: string; userid?: string; nickname?: string }> {
    await waitReady(4000);
    const r = (await kwCall("loginQrCheck", { key })) as any;
    return { status: r.status, token: r.token ?? undefined, userid: r.userid ?? undefined, nickname: r.nickname ?? undefined };
  }

  async function addTrack(token: string, userid: string, listid: number, track: Track, dfid = "-"): Promise<{ status: number; msg?: string }> {
    await waitReady(6000);
    return (await kwCall("addTrack", { token, userid, listid, track, dfid })) as { status: number; msg?: string };
  }

  async function resolvePlaylistByName(input: { token: string; userid: string; name: string; dfid?: string }): Promise<{ listid: number; created: boolean }> {
    await waitReady(8000);
    return (await kwCall("resolvePlaylist", input)) as { listid: number; created: boolean };
  }

  async function clearPlaylistByName(input: { token: string; userid: string; name: string; currentId: number; dfid?: string }): Promise<{ listid: number; deleted: boolean; deletedId?: number; warning?: string }> {
    await waitReady(10000);
    return (await kwCall("clearPlaylist", input)) as { listid: number; deleted: boolean; deletedId?: number; warning?: string };
  }

  // --- the KuGou plugin: the same API, run through the channel ------------
  const kwQr = signal<string | null>(null);
  const kwStatus = signal("");
  const kwQuery = signal("");
  const kwSession = signal<{ token: string; userid: string; dfid?: string; nickname?: string } | null>(null);
  const kwTrack = signal<any>(null);

  const kwCall = async (method: string, params: any = {}): Promise<any> => {
    const plugin = plugins().find((p) => p.manifest.id === KUGOU_WEB_MANIFEST.id);
    if (!plugin) throw new Error("插件未安装");
    if (!isPluginRunning(KUGOU_WEB_MANIFEST.id)) throw new Error("插件未启用");
    return await channelFor(plugin).invoke(method, params, 15000);
  };

  const kugouInstalled = () => plugins().some((p) => p.manifest.id === KUGOU_WEB_MANIFEST.id);

  const installKugouPlugin = async () => {
    try {
      await installPlugin(dataDir(), KUGOU_WEB_MANIFEST, KUGOU_WEB_FILES);
      await refreshPlugins();
      kwStatus.set("酷狗插件已安装，点「启用」开始（启用即选中平台）");
      showFlash("酷狗插件已安装");
      log("酷狗插件已安装");
    } catch (e: any) {
      kwStatus.set("安装失败: " + String(e?.message ?? e));
      log("酷狗插件安装失败: " + String(e?.message ?? e));
    }
  };

  const kwPollLogin = async (key: string, gen: number) => {
    if (gen !== pluginLoginGen || !pluginsOn()[KUGOU_WEB_MANIFEST.id]) return;
    try {
      const r = await kwCall("loginQrCheck", { key });
      if (gen !== pluginLoginGen) return;
      if (r.status === 4 && r.token && r.userid) {
        const session = { token: String(r.token), userid: String(r.userid), dfid: "-", nickname: r.nickname ?? undefined };
        kwSession.set(session);
        kwQr.set(null);
        kwStatus.set(`已登录：${session.nickname ?? session.userid}`);
        await storage.setItem(`plugin.${KUGOU_WEB_MANIFEST.id}.session`, JSON.stringify(session)).catch(storageError);
        log(`酷狗插件登录成功: ${session.nickname ?? session.userid}`);
        return;
      }
      if (r.status === 0) { kwStatus.set("二维码已过期，请刷新"); return; }
      kwStatus.set(r.status === 2 ? "已扫码，请在手机上确认" : "等待扫码…");
      setTimeout(() => kwPollLogin(key, gen), 2000);
    } catch (e: any) {
      kwStatus.set("扫码状态失败: " + String(e?.message ?? e));
    }
  };

  // A previous run's login, kept with the plugin's id like any plugin data.
  effect(() => {
    storage.getItem(`plugin.${KUGOU_WEB_MANIFEST.id}.session`).then((raw) => {
      if (!raw || kwSession()) return;
      try {
        const saved = JSON.parse(raw);
        if (saved?.token && saved?.userid) kwSession.set(saved);
      } catch {}
    }).catch(() => {});
  });

  let pluginLoginGen = 0;
  const kwLogin = async () => {
    const gen = ++pluginLoginGen;
    kwStatus.set("正在获取二维码…");
    try {
      const r = await kwCall("loginQrKey");
      if (gen !== pluginLoginGen) return;
      kwQr.set(r.image || null);
      kwStatus.set("等待扫码…");
      kwPollLogin(r.key, gen);
    } catch (e: any) {
      kwStatus.set("二维码生成失败: " + String(e?.message ?? e));
    }
  };

  const kwSearch = async (): Promise<any[]> => {
    const keyword = kwQuery().trim();
    if (!keyword) { kwStatus.set("请输入歌名"); return []; }
    kwStatus.set("搜索中…");
    try {
      const tracks = await kwCall("search", { keyword, pagesize: 5 });
      kwTrack.set(tracks[0] ?? null);
      kwStatus.set(tracks.length
        ? `找到 ${tracks.length} 首，第一首：${tracks[0].artist} - ${tracks[0].name}`
        : "没有找到");
      return tracks;
    } catch (e: any) {
      kwStatus.set("搜索失败: " + String(e?.message ?? e));
      return [];
    }
  };

  const kwPlaylists = async () => {
    const session = kwSession();
    if (!session) { kwStatus.set("请先扫码登录"); return; }
    try {
      const list = await kwCall("playlists", session);
      kwStatus.set(`歌单 ${list.length} 个：${list.slice(0, 4).map((p: any) => p.name).join("、")}`);
    } catch (e: any) {
      kwStatus.set("歌单加载失败: " + String(e?.message ?? e));
    }
  };

  // The plugin's own known-answer check (scripts/kat-kugou-plugin.mjs): the
  // same numbers have to come out of a page and out of Node.
  const kwSelfTest = async () => {
    try {
      const result = await kwCall("selftest");
      kwStatus.set(JSON.stringify(result));
    } catch (e: any) {
      kwStatus.set(JSON.stringify({ error: String(e?.message ?? e) }));
    }
  };

  // The whole point of the plugin: resolve the editable playlist name through
  // it, then add the first search result. Nothing here is compiled in.
  const kwAdd = async () => {
    const session = kwSession();
    if (!session) { kwStatus.set("请先扫码登录"); return; }
    const track = kwTrack();
    if (!track) { const found = await kwSearch(); if (!found.length) return; }
    const name = config().target_playlist_name.trim();
    if (!name) { kwStatus.set("请先在左栏填写歌单名"); return; }
    try {
      kwStatus.set(`解析歌单「${name}」…`);
      const resolved = await kwCall("resolvePlaylist", { ...session, name });
      kwStatus.set(`歌单 id ${resolved.listid}${resolved.created ? "（新建）" : ""}，正在加入…`);
      const res = await kwCall("addTrack", { ...session, listid: resolved.listid, track: kwTrack() });
      kwStatus.set(res.status === 1 ? `已加入：${kwTrack().name}` : `加入失败：status=${res.status}`);
      log(`酷狗插件加入歌单: ${kwTrack().name} (${res.status})`);
    } catch (e: any) {
      kwStatus.set("加入失败: " + String(e?.message ?? e));
    }
  };

  // --- plugin channel (experimental) -------------------------------------
  // A plugin is `${dataDir}/plugins/<id>/` with plugin.json and one JS module.
  // The app runs that module in a hidden WebView, the only way an NSH app can
  // run code it did not compile, and calls it over the bridge in src/plugin/.
  const plugins = signal<InstalledPlugin[]>([]);
  const pluginsOn = signal<Record<string, boolean>>({});
  const pluginStatus = signal<Record<string, string>>({});
  const channels = new Map<string, PluginChannel>();

  // Selecting a platform plugin is what enables it (there is one at a time);
  // other plugins have their own switch.
  const isPluginRunning = (id: string) =>
    pluginsOn()[id] === true || config().active_plugin === id;

  const setPluginStatus = (id: string, text: string) =>
    pluginStatus.update((v) => ({ ...v, [id]: text }));

  // What a plugin may ask the app for. Deliberately small: logging, its own
  // storage, and the app's own fetch (so the app's capabilities and headers
  // still apply to what a plugin fetches through it).
  const pluginPrimitives = (id: string) => ({
    log: async ({ line }: any) => {
      log(`[插件 ${id}] ${line}`);
      return true;
    },
    "storage.get": async ({ key }: any) => {
      const raw = await storage.getItem(`plugin.${id}.${key}`);
      return raw == null ? null : JSON.parse(raw);
    },
    "storage.set": async ({ key, value }: any) => {
      await storage.setItem(`plugin.${id}.${key}`, JSON.stringify(value ?? null));
      return true;
    },
    // A plugin's page cannot read a cross-origin answer (CORS), so its HTTP
    // goes through the app: same capabilities, same hosts, no preflight.
    "http.json": async ({ url, method, headers, body, as }: any) => {
      if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("插件只能通过应用请求 https 地址");
      const res = await fetch(url, { method: method ?? "GET", headers: headers ?? undefined, body: body ?? undefined });
      if (as === "text") return await res.text();
      if (as === "base64") {
        const bytes = new Uint8Array(await res.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      }
      return await res.json();
    },
  });

  const channelFor = (plugin: InstalledPlugin) => {
    const id = plugin.manifest.id;
    let channel = channels.get(id);
    if (!channel) {
      channel = new PluginChannel(id, pluginPrimitives(id), log);
      channels.set(id, channel);
    }
    return channel;
  };

  // `silent`: the first scan runs at startup, where a platform without a
  // filesystem (the headless test runner) would only add a scary line.
  const refreshPlugins = async (silent = false) => {
    try {
      const found = await listPlugins(dataDir());
      plugins.set(found);
      const on: Record<string, boolean> = {};
      for (const p of found) on[p.manifest.id] = (await storage.getItem(`plugin.${p.manifest.id}`)) === "1";
      pluginsOn.set(on);
    } catch (e: any) {
      if (!silent) log("插件目录读取失败: " + String(e?.message ?? e));
    }
  };

  const togglePlugin = async (id: string) => {
    const blocked = plugins().find((p) => p.manifest.id === id)?.blocked;
    if (blocked) { setPluginStatus(id, blocked); return; }
    const next = !pluginsOn()[id];
    pluginsOn.update((v) => ({ ...v, [id]: next }));
    setPluginStatus(id, next ? "已启用，正在加载…" : "已停用");
    try {
      await storage.setItem(`plugin.${id}`, next ? "1" : "0");
      log(`插件 ${id} ${next ? "已启用" : "已停用"}`);
    } catch (e: any) {
      storageError(e);
    }
  };

  const installDemoPlugin = async () => {
    try {
      await installPlugin(dataDir(), DEMO_PLUGIN, { [DEMO_PLUGIN.entry]: DEMO_SOURCE });
      await refreshPlugins();
      setPluginStatus(DEMO_PLUGIN.id, "已安装，点「启用」开始");
      log(`示例插件已安装到 ${pluginsDir(dataDir())}/${DEMO_PLUGIN.id}`);
    } catch (e: any) {
      log("示例插件安装失败: " + String(e?.message ?? e));
      showFlash("示例插件安装失败: " + String(e?.message ?? e));
    }
  };

  const uninstallPlugin = async (id: string) => {
    try {
      if (config().active_plugin === id) patch({ active_plugin: "", auto_sync: false });
      channels.delete(id);
      await removePlugin(dataDir(), id);
      await storage.removeItem(`plugin.${id}`);
      await storage.setItem(`plugin.${id}.removed`, "1").catch(() => {});
      showFlash(`已移除插件：${id}`);
      await refreshPlugins();
      log(`插件 ${id} 已移除`);
    } catch (e: any) {
      log("插件移除失败: " + String(e?.message ?? e));
    }
  };

  const callPlugin = async (id: string, method: string, params: any) => {
    const plugin = plugins().find((p) => p.manifest.id === id);
    if (!plugin) { setPluginStatus(id, "插件不存在"); return; }
    if (plugin.blocked) { setPluginStatus(id, plugin.blocked); return; }
    if (!pluginsOn()[id]) { setPluginStatus(id, "请先启用"); return; }
    setPluginStatus(id, "调用中…");
    try {
      const result = await channelFor(plugin).invoke(method, params);
      const text = Array.isArray(result)
        ? result.length === 0 ? "(空)" : String(result[0]?.name ?? JSON.stringify(result[0]))
        : JSON.stringify(result);
      setPluginStatus(id, `${method} → ${text}`);
      log(`插件 ${id} ${method} → ${text}`);
    } catch (e: any) {
      setPluginStatus(id, `${method} 失败: ${String(e?.message ?? e)}`);
      log(`插件 ${id} ${method} 失败: ${String(e?.message ?? e)}`);
    }
  };

  // Tests seed a plugin folder through the app's own VM, which is the only
  // side that has the filesystem: a test file's VM has no data directory.
  const pluginSeed = host.params.pluginTestSeed as
    | { manifest: any; files: Record<string, string> }[]
    | undefined;
  effect(() => {
    refreshPlugins(true).then(async () => {
      // KuGou ships as a plugin; install it once unless the user removed it.
      const removed = await storage.getItem(`plugin.${KUGOU_WEB_MANIFEST.id}.removed`);
      const installed = (await listPlugins(dataDir())).some((p) => p.manifest.id === KUGOU_WEB_MANIFEST.id);
      if (!installed && removed !== "1") {
        try { await installPlugin(dataDir(), KUGOU_WEB_MANIFEST, KUGOU_WEB_FILES); } catch (e: any) {
          log("酷狗插件安装失败: " + String(e?.message ?? e));
        }
      }
      if (!installed && removed !== "1") await refreshPlugins(true);
      // The session may have been read before the plugin existed; once it is
      // on disk and mounted, restore it — a saved login must not ask again.
      if (!kugou()) restoreSession();
      if (!pluginSeed) return;
      for (const item of pluginSeed) {
        try {
          await installPlugin(dataDir(), item.manifest, item.files);
        } catch (e: any) {
          log("测试插件写入失败: " + String(e?.message ?? e));
        }
      }
      await refreshPlugins(true);
    });
  });

  const patch = (p: Partial<Config>) => config.update((c) => ({ ...c, ...p }));

  // --- Platform gating -----------------------------------------------------
  // One platform at a time, and it may be empty (all platforms off). The
  // old standalone `kugou_enabled` switch is gone: selecting the platform IS
  // the switch, and every playlist/song feature follows this value.
  const pluginEnabled = () => hasPlaylists(config().active_plugin);
  const platformName = () => platform(config().active_plugin)?.short ?? "平台";
  // The card's test id keeps the platform's historical name, so tests and
  // anyone's automation do not have to know it became a plugin ("kugou-web").
  const platformTestId = (id: string) => (id === "kugou-web" ? "plugin-kugou" : `plugin-${id}`);
  const selectPlugin = (id: PluginId) => {
    const next = config().active_plugin === id ? "" : id;
    // A platform change is a transaction boundary: invalidate any in-flight
    // resolve (so it cannot re-enable auto-sync), QR polling and queued
    // searches, and stop the worker by disabling auto-sync.
    playlistOpGen += 1;
    loginGen += 1;
    qr.set(null);
    searchQueue.length = 0;
    startedSearches.clear();
    patch({ active_plugin: next, kugou_enabled: next === "kugou-web", auto_sync: false });
    showFlash(next ? `已启用${platform(next)!.name}` : "已停用所有平台插件");
  };
  const singers = () => config().blacklist_singers ?? [];
  const blockedReason = (track: { name: string; artist: string }): string | null => {
    if (bl().includes(track.name)) return "song";
    const artist = (track.artist ?? "").trim();
    if (artist && singers().some((s) => s && (artist.includes(s) || s.includes(artist)))) return "singer";
    return null;
  };

  const blackRows = () => {
    const meta = config().blacklist_meta ?? {};
    return [
      ...bl().map((name) => ({ key: `song:${name}`, type: "song" as const, name, singer: "—", stamp: dateStamp(meta[`song:${name}`] ?? 0) })),
      ...singers().map((name) => ({ key: `singer:${name}`, type: "singer" as const, name, singer: name, stamp: dateStamp(meta[`singer:${name}`] ?? 0) })),
    ];
  };

  const isCoolingDown = (name: string) => {
    const cd = config().cooldown_seconds;
    if (cd <= 0) return false;
    const now = Math.floor(Date.now() / 1000);
    return played().some((p) => p.song_name === name && now - p.played_at < cd);
  };

  const overLimit = (s: DanmuInfo) => {
    const max = config().max_songs_per_user;
    return max > 0 && s.uid !== "manual" && played().filter((p) => p.uid === s.uid).length >= max;
  };

  const sessionStart = () => {
    const all = [...songs(), ...played()];
    return all.length ? Math.min(...all.map((s) => s.send_time)) : 0;
  };

  // --- Eager Kugou search cache --------------------------------------------
  const ledger = new SyncLedger();
  const startedSearches = new Set<string>();
  const searchAttempts = new Map<string, number>();
  const searchQueue: string[] = [];
  let searchesInFlight = 0;

  const runSearchQueue = () => {
    if (!pluginEnabled()) { searchQueue.length = 0; return; }
    while (searchesInFlight < 2 && searchQueue.length > 0) {
      const name = searchQueue.shift()!;
      searchesInFlight += 1;
      kgCache.update((c) => ({ ...c, [name]: { status: "pending" } }));
      search({ keyword: name, pagesize: 5 })
        .then((tracks) => {
          const t = tracks[0];
          const entry: SearchState = t
            ? { status: "found", track: { name: t.name, artist: t.artist, hash: t.hash, albumId: t.albumId, mixSongId: t.mixSongId, duration: t.duration } }
            : { status: "not_found" };
          kgCache.update((c) => ({ ...c, [name]: entry }));
          if (t && blockedReason({ name: t.name, artist: t.artist })) log(`黑名单跳过: ${name}`);
        })
        .catch((e: any) => {
          kgCache.update((c) => ({ ...c, [name]: { status: "error", msg: String(e?.message ?? e) } }));
          // Retry transient failures; keep `startedSearches` so the effect
          // cannot enqueue the same name twice.
          const attempt = (searchAttempts.get(name) ?? 0) + 1;
          searchAttempts.set(name, attempt);
          if (attempt <= 3) {
            setTimeout(() => { searchQueue.push(name); runSearchQueue(); }, 2000 * attempt);
          } else {
            log(`酷狗搜索放弃: ${name}`);
          }
        })
        .finally(() => { searchesInFlight -= 1; runSearchQueue(); });
    }
  };

  const queueSearches = (list: DanmuInfo[]) => {
    if (!pluginEnabled() || !kugou()) return;
    for (const s of list) {
      const name = s.song_name.trim();
      if (!name || startedSearches.has(name)) continue;
      startedSearches.add(name);
      searchQueue.push(name);
    }
    runSearchQueue();
  };
  effect(() => queueSearches([...songs(), ...played()]));

  // --- One sync entry point, shared by the worker and manual presses --------
  let syncGen = 0;
  let syncTimer: number | null = null;
  let syncBusy = false;
  let syncFailures = 0;

  const stopWorker = () => {
    syncGen += 1;
    if (syncTimer !== null) { clearTimeout(syncTimer); syncTimer = null; }
    syncBusy = false;
    ledger.abortInFlight();
  };

  const moveToPlayed = (song: DanmuInfo) => {
    // A late success must not resurrect a row the user deleted or cleared
    // while the write was in flight.
    if (!songs().some((s) => s.msg_id === song.msg_id)) return;
    if (played().some((p) => p.msg_id === song.msg_id)) return;
    songs.update((v) => v.filter((s) => s.msg_id !== song.msg_id));
    played.update((v) => [{ ...song, played_at: Math.floor(Date.now() / 1000) }, ...v]);
    log(`已点: ${song.uname} - ${song.song_name}`);
  };

  const performSync = async (
    song: DanmuInfo,
    track: { name: string; artist: string; hash: string; albumId?: string; mixSongId?: string; duration?: number },
    key: string,
    gen: number,
    manual = false,
  ): Promise<boolean> => {
    const sess = kugou();
    const target = config().target_playlist_id;
    if (!sess || !target) { ledger.failed(key, "not logged in", 10); return false; }
    try {
      const res = await addTrack(sess.token, sess.userid, target, track as Track, sess.dfid ?? "-");
      if (res.status === 1) {
        // Record success even for an old generation: the write already
        // happened upstream, so the new worker must never replay it.
        ledger.synced(key, track.hash);
        // The write already happened upstream, so the row must move even if
        // config/session changed while it was in flight. Otherwise ledger
        // says "synced" forever, the worker never retries, and a manual press
        // only says "正在加入": the row is stuck in the queue for good.
        if (ledger.phase(key) === "synced") moveToPlayed(song);
        if (gen !== syncGen) {
          log(`${manual ? "手动加入" : "酷狗自动加入"} (切换前): ${track.name}`);
          return true;
        }
        syncFailures = 0;
        log(`${manual ? "手动加入歌单" : "酷狗自动加入"}: ${track.name}`);
        return true;
      }
      if (gen !== syncGen) {
        ledger.failed(key, String(res.msg ?? res.status), 10);
        return false;
      }
      const auth = isAuthFailure(res);
      syncFailures += 1;
      ledger.failed(key, String(res.msg ?? res.status), auth ? 3600 : nextDelay(syncFailures) / 1000);
      log(`酷狗加入失败: ${track.name} (${res.status})`);
      if (manual) showFlash(`加入失败：${String(res.msg ?? res.status)}`);
      if (auth) {
        kgState.set("expired");
        kgMsg.set("酷狗登录已失效，请重新扫码");
        log("酷狗登录已失效，自动同步已停止");
        stopWorker();
      }
      return false;
    } catch (e: any) {
      if (gen !== syncGen) {
        ledger.failed(key, String(e?.message ?? e), 10);
        return false;
      }
      syncFailures += 1;
      ledger.failed(key, String(e?.message ?? e), nextDelay(syncFailures) / 1000);
      log("酷狗自动同步失败: " + String(e?.message ?? e));
      if (manual) showFlash(`加入失败：${String(e?.message ?? e)}`);
      return false;
    }
  };

  effect(() => {
    const enabled = pluginEnabled() && (config().auto_sync ?? false) && !!kugou() && !!config().target_playlist_id;
    const sessionKey = kugou()?.token ?? "";
    const target = config().target_playlist_id;
    const expired = kgState() === "expired";
    void sessionKey; void target;
    stopWorker();
    if (!enabled || expired) return;
    const gen = syncGen;
    let tick: () => Promise<void> = async () => {};
    const schedule = (delay: number) => {
      if (gen !== syncGen) return;
      syncTimer = setTimeout(() => { void tick(); }, delay);
    };
    tick = async () => {
      if (gen !== syncGen) return;
      if (syncBusy) { schedule(1000); return; }
      syncBusy = true;
      try {
        const picked = pickNextSync(songs(), {
          cache: kgCache(),
          ledger,
          blocked: (t) => blockedReason(t),
          overLimit,
          coolingDown: isCoolingDown,
        });
        if (!picked) return;
        if (!ledger.claim(picked.key)) return;
        await performSync(picked.song, picked.track, picked.key, gen);
      } finally {
        syncBusy = false;
        schedule(nextDelay(syncFailures));
      }
    };
    schedule(2000);
  });

  // A one-second tick for the footer's elapsed-time stat.
  let tickTimer: number | null = null;
  effect(() => {
    const on = ["解析房间...", "连接中...", "已连接"].includes(status());
    if (on && tickTimer === null) {
      tickTimer = setInterval(() => nowTick.set(Math.floor(Date.now() / 1000)), 1000);
    } else if (!on && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  });

  const checkUpdate = async () => {
    aboutBusy.set(true);
    aboutMsg.set("正在检查…");
    updateInfo.set(null);
    updateProgress.set(null);
    try {
      const update = await checkForUpdate();
      if (!update) {
        aboutMsg.set(`已是最新版本 v${APP_VERSION}`);
        return;
      }
      updateInfo.set(update);
      aboutMsg.set(
        update.canInstall
          ? `发现新版本 ${update.version}，可直接下载安装`
          : `发现新版本 ${update.version}，请到 GitHub Releases 下载`,
      );
    } catch (e: any) {
      aboutMsg.set("检查更新失败：" + String(e?.message ?? e));
    } finally {
      aboutBusy.set(false);
    }
  };

  // One button does both steps: download the archive, then swap it in and
  // restart. On iOS/Android (canInstall false) it opens the download page.
  const installUpdate = async () => {
    const found = updateInfo();
    if (!found || aboutBusy()) return;
    if (!found.canInstall) {
      await openUrl(found.url);
      return;
    }
    aboutBusy.set(true);
    updateProgress.set(0);
    try {
      aboutMsg.set(`正在下载 ${found.version}…`);
      await downloadUpdate(({ received, total }: { received: number; total?: number | null }) => {
        updateProgress.set(total ? Math.min(1, received / total) : null);
      });
      aboutMsg.set("下载完成，正在安装并重启…");
      await installAndRestart();
    } catch (e: any) {
      aboutMsg.set("更新失败：" + String(e?.message ?? e));
    } finally {
      aboutBusy.set(false);
      updateProgress.set(null);
    }
  };
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

  type SongRow = { i: number; song: DanmuInfo; entry?: SearchState; blocked: string | null; sub: string };
  type PlayedRow = { i: number; song: PlayedInfo };

  const songRows = (): SongRow[] => {
    const cache = kgCache();
    return songs().map((s, i) => {
      // A cache miss is only "pending" while a search is actually allowed to
      // run. Without a Kugou session the original shows no subtitle at all.
      const searching = pluginEnabled() && !!kugou();
      const entry = searching ? (cache[s.song_name.trim()] ?? { status: "pending" as const }) : undefined;
      const blocked = entry?.status === "found" ? blockedReason(entry.track) : null;
      const sub = blocked
        ? `黑名单 (${blocked === "singer" ? "歌手" : "歌曲"})`
        : entry?.status === "found" ? `${platformName()}: ${entry.track.artist || "未知歌手"}`
        : entry?.status === "pending" ? "酷狗搜索中…"
        : entry?.status === "not_found" ? "酷狗未找到"
        : entry?.status === "error" ? "酷狗搜索失败"
        : searching ? "手动添加"
        // No platform / no login: no Kugou search was made, so do not claim a
        // match is in progress. The footer already says 酷狗未登录.
        // Keep the row's real origin instead of relabelling manual adds.
        : pluginEnabled() ? ""
        : s.uid === "manual" ? "手动添加" : "弹幕点歌";
      return { i, song: s, entry, blocked, sub };
    });
  };

  const playedRows = (): PlayedRow[] => filteredPlayed().map((s, i) => ({ i, song: s }));

  const addSong = (danmu: DanmuInfo) => {
    if (songs().some((s) => s.song_name === danmu.song_name) || played().some((s) => s.song_name === danmu.song_name)) {
      log(`重复跳过: ${danmu.song_name}`);
      showFlash(`已在列表中：${danmu.song_name}`);
      return;
    }
    const max = config().max_songs_per_user;
    if (max > 0 && danmu.uid !== "manual") {
      const count = played().filter((s) => s.uid === danmu.uid).length;
      if (count >= max) {
        log(`超过每人上限: ${danmu.uname} (${count}/${max})`);
        showFlash(`已达每人上限 (${count}/${max})`);
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
      const info = parseRoomInfo(html);
      if (info) roomInfo.set(info);
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
    // Defensive: the input is unmounted without a Kugou platform, but a stale
    // keyboard submit must not inject a song into a listener-only session.
    if (!pluginEnabled()) {
      showFlash("仅弹幕监听模式：设置 → 插件 → 启用酷狗音乐后可手动点歌");
      return;
    }
    const name = manual().trim();
    if (!name) { showFlash("请输入歌名"); return; }
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

  // One shared, visible status line. It never covers a control, so it cannot
  // swallow a press; a test can assert it through app.texts().
  // Toasts (`nsh/base`'s stack): kept by a manager whose clock the app drives,
  // rendered newest-first from the bottom-right corner.
  const toasts = new ToastManager();
  const toastTick = signal(0);
  const toastExpanded = signal(false);
  let toastTimer: number | null = null;
  let toastSeq = 0;

  const advanceToasts = () => {
    const advanced = toasts.advance(toastExpanded());
    if (advanced.changed) toastTick.update((v) => v + 1);
    if (toasts.isEmpty() && toastTimer !== null) {
      clearInterval(toastTimer);
      toastTimer = null;
    }
  };
  const showFlash = (msg: string, tone: "info" | "success" | "error" = "info") => {
    toasts.push(`toast-${++toastSeq}`, { msg, tone }, { timeout: tone === "error" ? 6000 : 3200 });
    toastTick.update((v) => v + 1);
    if (toastTimer === null) toastTimer = setInterval(advanceToasts, 200);
  };

  // Clipboard.writeText returns a Promise. Log only after it resolves, and
  // always report failures: an ungranted capability used to fail silently.
  let copySeq = 0;
  const copyText = (text: string, label: string) => {
    const id = ++copySeq;
    let settled = false;
    let timer: number | null = null;
    const finish = (ok: boolean, detail: string) => {
      if (settled || id !== copySeq) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (ok) { showFlash(`已复制${label}`); log(`已复制${label}`); }
      else { showFlash(`复制失败：${detail}`); log(`复制失败：${detail}`); }
    };
    // Immediate feedback: the press must never look like a no-op.
    showFlash(`正在复制${label}…`);
    Clipboard.writeText(text)
      .then(() => finish(true, ""))
      .catch((e: any) => finish(false, String(e?.message ?? e)));
    // Some native hosts leave the clipboard promise pending while the window
    // is inactive. Always settle, but never let an old call overwrite a newer one.
    timer = setTimeout(() => finish(false, "剪贴板无响应"), 2000);
  };

  const clearList = () => {
    const tab = activeTab();
    if (tab === "blacklist") return;
    const count = tab === "songs" ? songs().length : played().length;
    if (count === 0) return;
    if (clearConfirm() !== tab) {
      clearConfirm.set(tab);
      showFlash(`再点一次「确认清空」以清空 ${count} 首`);
      if (clearTimer !== null) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => clearConfirm.set(null), 4000);
      return;
    }
    clearConfirm.set(null);
    if (clearTimer !== null) clearTimeout(clearTimer);
    if (tab === "songs") songs.set([]);
    else { played.set([]); playedQuery.set(""); }
    showFlash(`已清空 ${count} 首`);
    log(`已清空${tab === "songs" ? "点歌" : "已点"}列表 ${count} 首`);
  };

  // Original: the row's ListPlus button is one transaction — addTrack succeeds
  // and only then does the row move to 已点. It is independent of auto_sync,
  // and goes through the same ledger claim as the worker so a song is never
  // written twice. A failed write leaves the row in the queue.
  const addTrackToPlayed = async (song: DanmuInfo) => {
    const key = song.msg_id;
    if (!pluginEnabled() || !kugou() || !config().target_playlist_id) {
      showFlash("请先登录酷狗并设置歌单");
      return;
    }
    // A worker already owns this song: give the state an accurate message.
    // Never call ledger.manual() here — it means the user moved the row, and
    // would make the worker's late success skip the move.
    if (!ledger.claim(key)) {
      const phase = ledger.phase(key);
      showFlash(phase === "failed" ? `稍后重试：${song.song_name}`
        : phase === "synced" ? `已加入：${song.song_name}`
        : `正在加入：${song.song_name}`);
      return;
    }
    const gen = syncGen;
    const entry = kgCache()[song.song_name.trim()];
    const cached = entry?.status === "found" ? entry.track : null;
    if (cached) {
      if (blockedReason(cached)) {
        ledger.failed(key, "blacklisted", 3600);
        showFlash(`黑名单跳过：${song.song_name}`);
        return;
      }
      void performSync(song, cached, key, gen, true);
      return;
    }
    try {
      const tracks = await search({ keyword: song.song_name, pagesize: 3 });
      if (gen !== syncGen) {
        ledger.failed(key, "config changed", 10);
        return;
      }
      const t = tracks[0];
      if (!t) {
        ledger.failed(key, "not found", 30);
        showFlash(`酷狗未找到：${song.song_name}`);
        return;
      }
      if (blockedReason(t)) {
        ledger.failed(key, "blacklisted", 3600);
        showFlash(`黑名单跳过：${song.song_name}`);
        return;
      }
      void performSync(song, t, key, gen, true);
    } catch (e: any) {
      if (gen !== syncGen) return;
      ledger.failed(key, String(e?.message ?? e), 10);
      showFlash(`加入失败：${String(e?.message ?? e)}`);
    }
  };

  // Delete by msg_id, never by row index: new songs are prepended, so an
  // index captured before an await can silently point at a different row.
  const removeSong = (song: DanmuInfo) => {
    songs.update((v) => v.filter((s) => s.msg_id !== song.msg_id));
    log(`删除: ${song.uname} - ${song.song_name}`);
    showFlash(`已删除：${song.song_name}`);
  };

  const removePlayed = (song: DanmuInfo) => {
    played.update((v) => v.filter((s) => s.msg_id !== song.msg_id));
    log(`删除已点: ${song.song_name}`);
    showFlash(`已删除：${song.song_name}`);
  };

  // Shared guard: playlist mutations (resolve on auto-sync ON, 清理) must not
  // interleave. A generation bump invalidates an in-flight resolve so a late
  // result can never point auto-sync at a playlist that was just deleted.
  let playlistOpGen = 0;
  let autoSyncBusy = false;
  let clearingPlaylist = false;
  let autoSyncNoNameConfirm = false;

  // Original handleAutoSyncToggle: turning auto-sync ON resolves the editable
  // playlist name with using-exist-or-create FIRST, writes the listid, and
  // only then enables sync. A failed resolve leaves auto-sync OFF.
  const toggleAutoSync = async () => {
    if (autoSyncBusy || clearingPlaylist) { showFlash("正在处理歌单，请稍候"); return; }
    if (!pluginEnabled()) { showFlash("酷狗服务未开启"); return; }
    if (config().auto_sync) { patch({ auto_sync: false }); autoSyncNoNameConfirm = false; return; }
    const sess = kugou();
    if (!sess) { showFlash("请先扫码登录酷狗"); return; }
    const name = config().target_playlist_name.trim();
    if (!name && !config().target_playlist_id) {
      if (!autoSyncNoNameConfirm) {
        autoSyncNoNameConfirm = true;
        showFlash("未填写歌单名，自动同步不会加入歌单；再点一次确认开启");
        setTimeout(() => { autoSyncNoNameConfirm = false; }, 4000);
        return;
      }
      autoSyncNoNameConfirm = false;
    }
    autoSyncBusy = true;
    const gen = ++playlistOpGen;
    try {
      if (name) {
        showFlash(`正在检查歌单：${name}…`);
        try {
          const res = await resolvePlaylistByName({
            token: sess.token, userid: sess.userid, dfid: sess.dfid, name,
          });
          if (gen !== playlistOpGen || clearingPlaylist || !pluginEnabled() || !kugou()
              || kugou()!.token !== sess.token || config().target_playlist_name.trim() !== name) {
            // The playlist may still have been created; make that visible.
            showFlash("歌单检查已取消（配置或登录发生变化），自动同步未开启");
            return;
          }
          patch({ target_playlist_id: res.listid });
          lists.update((v) => v.some((p) => p.listid === res.listid)
            ? v
            : [{ name, listid: res.listid, count: 0 }, ...v]);
          const msg = res.created
            ? `歌单不存在，已创建 ${name} (id: ${res.listid})`
            : `找到同名歌单 ${name} (id: ${res.listid})`;
          log(msg);
          showFlash(msg);
        } catch (e: any) {
          const msg = `解析歌单失败，自动同步未开启：${String(e?.message ?? e)}`;
          log(msg);
          showFlash(msg);
          return;
        }
      }
      if (gen !== playlistOpGen || !pluginEnabled()) return;
      patch({ auto_sync: true });
    } finally {
      autoSyncBusy = false;
    }
  };

  // Original's red 清理 button: delete the target playlist and recreate it
  // under the same name. The button is only shown when logged in, and every
  // failure is reported instead of silently doing nothing.
  const clearPlaylist = async () => {
    if (clearingPlaylist || autoSyncBusy) { showFlash("正在处理歌单，请稍候"); return; }
    const sess = kugou();
    if (!pluginEnabled() || !sess) { showFlash("请先登录酷狗"); return; }
    const name = config().target_playlist_name.trim();
    if (!name) { showFlash("请先填歌单名"); return; }
    const oldId = config().target_playlist_id;
    clearingPlaylist = true;
    // Invalidate any resolve that is still in flight.
    playlistOpGen += 1;
    // Gate every playlist write before deleting: the worker, manual ListPlus
    // and the settings "加入歌单" all read target_playlist_id. Zeroing it (and
    // stopping the worker) prevents writing into a playlist we are about to
    // delete during the get_all_list → delete_list → add_list round trips.
    stopWorker();
    patch({ target_playlist_id: 0 });
    showFlash(`正在清理歌单：${name}…`);
    try {
      const res = await clearPlaylistByName({
        token: sess.token, userid: sess.userid, dfid: sess.dfid,
        name, currentId: oldId,
      });
      patch({ target_playlist_id: res.listid, target_playlist_name: name });
      // Do not refetch: a fresh list may not contain the new id yet, and
      // loadLists would silently reset the config to the first old playlist.
      // Only remove the old entry when it was really deleted.
      const removed = res.deleted ? (res.deletedId ?? oldId) : null;
      lists.update((v) => [
        { name, listid: res.listid, count: 0 },
        ...v.filter((p) => p.listid !== res.listid && p.listid !== removed),
      ]);
      const msg = res.warning
        ? `新歌单已建 (id: ${res.listid})，${res.warning}`
        : `歌单已清理重建 (id: ${res.listid})`;
      showFlash(msg);
      log(msg);
    } catch (e: any) {
      if (e?.deletedOld) {
        // The old playlist is gone (or its state is unknown): leave the id at
        // 0 so auto-sync cannot write into a deleted list, and drop the entry.
        const removed = e.deletedId ?? oldId;
        lists.update((v) => v.filter((p) => p.listid !== removed));
      } else {
        // A definite failure: nothing was deleted, restore the old target.
        patch({ target_playlist_id: oldId });
      }
      const msg = `清理失败：${String(e?.message ?? e)}`;
      showFlash(msg);
      log(msg);
    } finally {
      clearingPlaylist = false;
    }
  };

  // Import a Tauri-era storage export (produced by

  const addBlackByName = (type: "song" | "singer", name: string) => {
    const clean = name.trim();
    const key = `${type}:${clean}`;
    const existing = type === "song" ? bl() : singers();
    if (existing.includes(clean)) { showFlash(`黑名单已有：${clean}`); return; }
    const meta = { ...(config().blacklist_meta ?? {}), [key]: Math.floor(Date.now() / 1000) };
    if (type === "song") patch({ blacklist: [...bl(), clean], blacklist_meta: meta });
    else patch({ blacklist_singers: [...singers(), clean], blacklist_meta: meta });
    log(`加入黑名单 (${type === "song" ? "歌曲" : "歌手"}): ${clean}`);
    showFlash(`已加入黑名单：${clean}`);
  };

  // Original right-click menu on the song cell: copy danmu / copy track name /
  // delete / blacklist the song or its singer.
  const openRowMenu = (e: any, song: DanmuInfo, from: "songs" | "played") => {
    const entry = kgCache()[song.song_name.trim()];
    const found = entry?.status === "found" ? entry.track : null;
    const items: any[] = [
      { label: "复制弹幕", onSelect: () => copyText(song.raw_msg || song.song_name, "弹幕") },
    ];
    // Without a platform there is no Kugou track to copy, so do not show a
    // permanently disabled "未找到" item.
    if (pluginEnabled() && !!kugou()) {
      items.push({ label: found ? "复制歌名" : "复制歌名 (未找到)", disabled: !found, onSelect: () => found && copyText(found.name, "歌名") });
    }
    items.push({ label: "删除", onSelect: () => from === "played" ? removePlayed(song) : removeSong(song) });
    if (pluginEnabled()) {
      if (found) {
        items.push({ label: `黑名单这首歌: ${found.name}`, onSelect: () => addBlackByName("song", found.name) });
        if (found.artist) items.push({ label: `黑名单该歌手: ${found.artist}`, onSelect: () => addBlackByName("singer", found.artist) });
      } else {
        items.push({ label: "加入黑名单 (搜索中…)", disabled: true });
      }
    }
    void Menu.popup(items, e.pagePosition);
  };

  const addBlack = () => {
    const name = blackInput().trim();
    if (!name) return;
    const type = blackType();
    const key = `${type}:${name}`;
    const existing = type === "song" ? bl() : singers();
    if (existing.includes(name)) { log(`黑名单已有: ${name}`); return; }
    const meta = { ...(config().blacklist_meta ?? {}), [key]: Math.floor(Date.now() / 1000) };
    if (type === "song") patch({ blacklist: [...bl(), name], blacklist_meta: meta });
    else patch({ blacklist_singers: [...singers(), name], blacklist_meta: meta });
    blackInput.set("");
    log(`加入黑名单 (${type === "song" ? "歌曲" : "歌手"}): ${name}`);
    showFlash(`已加入黑名单：${name}`);
  };

  const removeBlack = (key: string) => {
    const colon = key.indexOf(":");
    const type = key.slice(0, colon);
    const name = key.slice(colon + 1);
    if (type === "song") patch({ blacklist: bl().filter((s) => s !== name) });
    else patch({ blacklist_singers: singers().filter((s) => s !== name) });
    log(`移出黑名单: ${name}`);
    showFlash(`已移出黑名单：${name}`);
  };

  const running = () => ["解析房间...", "连接中...", "已连接"].includes(status());

  const inputStyle = () => ({
    color: token("foreground"),
    placeholderColor: token("muted-foreground"),
    caretColor: token("primary"),
  });

  const tabButton = (key: Tab, label: string) => (
    <Button
      onPress={() => activeTab.set(key)}
      class={`items-center justify-center rounded-[6px] px-3 py-1 ${activeTab() === key ? "bg-primary" : "border border-line-strong active:bg-background"}`}
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
        {/* Original AppHeader wraps the right actions in one flex-row with
            gap-1; start/stop adds ml-2. Keep that so the icon slots line up. */}
        <View class="flex-row items-center gap-1">
          {IconButton({ testID: "theme", name: colorScheme() === "dark" ? "sun" : "moon", onPress: toggleTheme, label: colorScheme() === "dark" ? "切换亮色" : "切换暗色", class: "h-[30px] w-[30px] rounded-(--radius) bg-transparent text-muted-foreground active:bg-muted", iconClass: "h-[15px] w-[15px]" })}
          {IconButton({ testID: "settings", name: "settings", onPress: () => openSettings("general"), label: "设置", class: "h-[30px] w-[30px] rounded-(--radius) bg-transparent text-muted-foreground active:bg-muted", iconClass: "h-[15px] w-[15px]" })}
          {/* Two Ifs, not If/else: the else element is built once, so a
              colour that follows the scheme would keep the first scheme's
              value and the play icon would vanish after a theme switch. */}
          <If when={running()}>
            {IconButton({ testID: "stop", name: "square", onPress: stop, class: "ml-[9px] mr-[1px] h-[30px] w-[30px] rounded-[6px] bg-[#c5403c] active:bg-danger-hover", iconClass: "h-[15px] w-[15px]", color: "#ffffff", label: "停止" })}
          </If>
          <If when={!running()}>
            {IconButton({ testID: "start", name: "play", onPress: start, class: "ml-[9px] mr-[1px] h-[30px] w-[30px] rounded-[6px] bg-foreground active:bg-muted-foreground", iconClass: "h-[15px] w-[15px]", color: colorScheme() === "dark" ? PALETTE.dark.background : PALETTE.light.background, label: "开始" })}
          </If>
        </View>
      </View>

      <View class="flex-1 min-h-0 flex-row">
        <View class="h-full w-72 shrink-0 flex-col border-r border-line bg-card">
        <Scroll testID="sidebar" class="min-h-0 flex-1">
          <View class="flex-col">
            <View class="p-4">
              <Text class="mb-3 text-[13px] font-medium leading-5 text-foreground">直播间配置</Text>
              <View class="gap-3">
                <View class="gap-1.5">
                  <View class="flex-row items-center justify-between gap-2">
                    <Text class="text-xs text-muted-foreground">抖音直播间 ID</Text>
                    <If when={roomInfo()}>
                      <View
                        class="inline-flex max-w-[60%] flex-row items-center gap-1"
                        testID="room-info"
                        tooltip={roomInfo()?.title
                          ? <Tooltip placement="right" offset={8} class="max-w-[260px] rounded-[8px] border border-line bg-popover p-2 shadow-md">
                              <Text class="text-[11px] leading-4 text-muted-foreground">{roomInfo()?.title}</Text>
                            </Tooltip>
                          : undefined}
                      >
                        <View class={`h-1.5 w-1.5 shrink-0 rounded-full ${roomInfo()?.status === 2 ? "bg-success" : "bg-faint"}`} />
                        <Text class="truncate text-[11px] text-foreground">{roomInfo()?.nickname}</Text>
                      </View>
                    </If>
                  </View>
                  <Input style={inputStyle()}
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
                    <View
                      testID="sing-prefix-tip"
                      class="p-[2px]"
                      tooltip={
                        <Tooltip placement="right" offset={8} class="max-w-[260px] gap-2 rounded-[8px] border border-line bg-popover p-3 shadow-md">
                          <Text class="text-[12px] font-semibold text-foreground">占位符说明</Text>
                          <View class="gap-1">
                            <Text class="text-[11px] leading-4 text-muted-foreground">
                              [song] 或 [歌曲] — 歌曲名
                            </Text>
                            <Text class="text-[11px] leading-4 text-muted-foreground">
                              [space] 或 [空格] — 空格
                            </Text>
                          </View>
                          <View class="h-px bg-line" />
                          <View class="gap-1">
                            <Text class="text-[11px] font-medium text-foreground">示例</Text>
                            <Text class="text-[11px] leading-4 text-foreground">点歌[space][song]</Text>
                            <Text class="text-[11px] leading-4 text-faint">→ 「点歌 七里香」</Text>
                            <Text class="text-[11px] leading-4 text-foreground">点歌[song]</Text>
                            <Text class="text-[11px] leading-4 text-faint">→ 「点歌七里香」</Text>
                          </View>
                        </Tooltip>
                      }
                    >
                      {Icon({ scheme: colorScheme(), name: "info", class: "h-3 w-3", color: "faint" })}
                    </View>
                  </View>
                  <Input style={inputStyle()}
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
                    <Input style={inputStyle()}
                      value={String(config().fans_level)}
                      onChange={({ value }) => patch({ fans_level: num(value) })}
                      class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                    />
                  </View>
                  <View class="flex-1 gap-1.5">
                    <Text class="text-xs text-muted-foreground">点歌冷却 (秒)</Text>
                    <Input style={inputStyle()}
                      value={String(config().sing_cd)}
                      onChange={({ value }) => patch({ sing_cd: num(value) })}
                      class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                    />
                  </View>
                </View>
                <View class="gap-1.5">
                  <Text class="text-xs text-muted-foreground">重复点歌冷却 (秒)</Text>
                  <Input style={inputStyle()}
                    value={String(config().cooldown_seconds)}
                    onChange={({ value }) => patch({ cooldown_seconds: num(value) })}
                    class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                  <Text class="text-[11px] text-faint">{pluginEnabled() ? "同一首歌在冷却时间内不会重复加入歌单" : "启用平台并开启自动同步后生效；仅监听模式不限制重复指令"}</Text>
                </View>
                <View class="gap-1.5">
                  <Text class="text-xs text-muted-foreground">单人单场点歌上限</Text>
                  <Input style={inputStyle()}
                    value={String(config().max_songs_per_user)}
                    onChange={({ value }) => patch({ max_songs_per_user: num(value) })}
                    class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                  <Text class="text-[11px] text-faint">{pluginEnabled() ? "每位观众本场最多自动点歌的首数（0 = 不限制）；手动加入不受限" : "按已加入歌单的首数计数；仅监听模式不启用该限制"}</Text>
                </View>
              </View>
            </View>

            <If when={pluginEnabled() && kugou()}>
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
                      <Input style={inputStyle()}
                        value={config().target_playlist_name}
                        onChange={({ value }) => {
                          const old = config().target_playlist_name.trim();
                          patch({ target_playlist_name: value });
                          if (config().auto_sync && value.trim() !== old) {
                            // The id still points at the old playlist; stop
                            // writing into it until the user re-enables sync.
                            patch({ auto_sync: false });
                            showFlash("歌单名已修改，自动同步已关闭；请重新开启以重新解析歌单");
                          }
                        }}
                        placeholder="自动加入歌单的名字"
                        class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                      />
                      <View class="flex-row gap-2">
                        {IconButton({
                          testID: "kugou-clear", name: "trash", text: "清理",
                          label: "清空并重建歌单", color: "danger-soft-fg",
                          textClass: "text-xs text-danger-soft-fg", iconClass: "h-3.5 w-3.5",
                          onPress: clearPlaylist,
                          class: "h-8 flex-1 rounded-(--radius) border border-danger-soft-fg bg-card px-2.5 active:bg-danger-soft-bg",
                        })}
                        <View
                          testID="auto-sync"
                          onPress={toggleAutoSync}
                          class="relative h-8 flex-1 flex-row items-center justify-center gap-2 overflow-hidden rounded-[4px] border px-2.5"
                          style={{
                            borderColor: config().auto_sync ? "transparent" : token("line-strong"),
                            backgroundColor: token("card"),
                            opacity: config().auto_sync ? 1 : 0.55,
                            ...(config().auto_sync
                              ? { boxShadow: "0 0 12px rgba(100,180,255,0.4), 0 0 24px rgba(100,180,255,0.2)" }
                              : {}),
                          }}
                        >
                          <If when={config().auto_sync}>
                            <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, overflow: "hidden", borderRadius: 4, pointerEvents: "none" }}>
                              <View style={{ position: "absolute", left: -100, top: -100, right: -100, bottom: -100, borderRadius: 7, backgroundImage: "conic-gradient(from 0deg, #00e676, #2979ff, #d500f9, #ff6d00, #00e676)", ...spinMotion.style }} />
                              <View style={{ position: "absolute", left: 1, top: 1, right: 1, bottom: 1, borderRadius: 3, backgroundColor: token("card") }} />
                            </View>
                          </If>
                          <View class="h-3 w-3 items-center justify-center" style={config().auto_sync ? spinMotion.style : undefined}>
                            {Icon({ scheme: colorScheme(), name: "refresh", class: "h-3 w-3", color: "foreground" })}
                          </View>
                          <Text class="text-xs text-foreground">{config().auto_sync ? "同步中" : "自动同步"}</Text>
                        </View>
                      </View>
                    </View>
                  </If>
                </View>
              </View>
            </If>

            <View class="h-px bg-line" />

            <If when={pluginEnabled()} else={
              <View class="px-4 py-3">
              <View class="gap-1 rounded-(--radius) border border-line bg-secondary px-3 py-2">
                <Text class="text-[13px] font-medium leading-5 text-foreground">仅弹幕监听</Text>
                <Text class="text-[11px] leading-4 text-muted-foreground">
                  {config().active_plugin === "netease"
                    ? "网易云音乐未接入：点歌指令只进「点歌列表」。"
                    : "点歌指令只进「点歌列表」；启用酷狗音乐后才有歌单与手动点歌。"}
                </Text>
                <Text class="text-[11px] text-faint">点「开始」连接直播间即可收集指令。</Text>
              </View>
              </View>
            }>
              <View class="p-4 pt-6">
                <Text class="mb-3 text-[13px] font-medium leading-5 text-foreground">手动点歌</Text>
                <View class="flex-row gap-2">
                  <Input style={inputStyle()}
                    value={manual()}
                    onChange={({ value }) => manual.set(value)}
                    onSubmit={addManual}
                    placeholder="输入歌曲名称..."
                    class="h-8 min-w-0 flex-1 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                  <Button onPress={addManual} class="items-center justify-center h-8 shrink-0 rounded-(--radius) border border-line-strong bg-card px-2.5 active:bg-muted">
                    <Text class="text-sm text-foreground">添加</Text>
                  </Button>
                </View>
              </View>
            </If>

            {/* The version ends the sidebar's content, so it scrolls with
                it instead of staying pinned to the window's bottom edge. */}
            <View class="px-4 pb-4 pt-1">
              <Text class="text-[11px] text-faint">SUSUSongBoard v{APP_VERSION}</Text>
            </View>
          </View>
        </Scroll>
        </View>

        <View class="flex-1 flex-col min-h-0 bg-card">
          <View class="flex-row items-center justify-between border-b border-line px-3 py-1 shrink-0">
            <View class="flex-row items-center">
              <Button onPress={() => activeTab.set("songs")} class={`h-9 items-center justify-center rounded-none border-0 border-b-2 bg-transparent px-3 ${activeTab() === "songs" ? "border-foreground" : "border-transparent"}`}>
                <Text class={`text-sm font-medium ${activeTab() === "songs" ? "text-foreground" : "text-muted-foreground"}`}>点歌列表 ({songs().length})</Text>
              </Button>
              <Button onPress={() => activeTab.set("played")} class={`h-9 items-center justify-center rounded-none border-0 border-b-2 bg-transparent px-3 ${activeTab() === "played" ? "border-foreground" : "border-transparent"}`}>
                <Text class={`text-sm font-medium ${activeTab() === "played" ? "text-foreground" : "text-muted-foreground"}`}>已点歌单 ({played().length})</Text>
              </Button>
              <Button onPress={() => activeTab.set("blacklist")} class={`h-9 items-center justify-center rounded-none border-0 border-b-2 bg-transparent px-3 ${activeTab() === "blacklist" ? "border-foreground" : "border-transparent"}`}>
                <Text class={`text-sm font-medium ${activeTab() === "blacklist" ? "text-foreground" : "text-muted-foreground"}`}>黑名单 ({blackRows().length})</Text>
              </Button>
            </View>
            <If when={activeTab() !== "blacklist" && (activeTab() === "songs" ? songs().length : played().length) > 0}>
              {IconButton({ testID: "clear-list", name: "trash", label: "清空列表", text: clearConfirm() === activeTab() ? "确认清空" : "清空列表", textClass: "text-xs text-muted-foreground", iconClass: "h-3.5 w-3.5", color: "muted-foreground", onPress: clearList, class: "h-7 rounded-(--radius) bg-transparent px-2.5 active:bg-muted" })}
            </If>
          </View>

          <View class="flex-1 min-h-0 flex-col">
            <If when={activeTab() === "songs"}>
              <If when={songs().length === 0} else={
                <View class="min-h-0 flex-1 flex-col">
                  {/* Sticky header, outside the scroll view, exactly as the
                      original SongTable does it. */}
                  <View class="h-8 shrink-0 flex-row items-center border-b border-line bg-secondary">
                    <View class="w-[40px] items-end pr-3"><Text class="text-xs font-medium text-muted-foreground">#</Text></View>
                    <View class="w-[120px] px-2"><Text class="text-xs font-medium text-muted-foreground">用户</Text></View>
                    <View class="min-w-0 flex-1 px-2"><Text class="text-xs font-medium text-muted-foreground">点歌</Text></View>
                    <View class="w-[72px] px-2"><Text class="text-xs font-medium text-muted-foreground">时间</Text></View>
                    <View class="w-[110px] px-2" />
                  </View>
                  <Scroll class="min-h-0 flex-1">
                    <View class="w-full">
                      {/* songRows() is read in JSX, so the whole list re-renders
                          when the search cache changes (NSH's Each does not
                          re-render an existing keyed row). */}
                      {songRows().map((r) => {
                          const song = r.song;
                          const max = config().max_songs_per_user;
                          const count = played().filter((p) => p.uid === song.uid).length;
                          const showCount = max > 0 && song.uid !== "manual";
                          const pending = pluginEnabled() && r.entry?.status === "pending";
                          const canAdd = pluginEnabled() && !!kugou() && config().target_playlist_id > 0
                            && r.entry?.status === "found" && !r.blocked
                            && ledger.canAttempt(song.msg_id);
                          return (
                            <View class="h-12 w-full flex-row items-center border-b border-line" hoverStyle={{ backgroundColor: token("muted") }}>
                              <View class="w-[40px] items-end pr-3"><Text class="text-xs text-faint">{r.i + 1}</Text></View>
                              <View class="w-[120px] flex-row items-center gap-1 px-2">
                                <Text class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{song.uname || "?"}</Text>
                                <If when={showCount}>
                                  <Text class={`shrink-0 rounded px-1 text-[10px] tabular-nums ${count >= max ? "bg-danger-soft-bg text-danger-soft-fg" : "bg-muted text-faint"}`}>{count}/{max}</Text>
                                </If>
                              </View>
                              <View class="min-w-0 flex-1 px-2" onContextMenu={(e: any) => openRowMenu(e, song, "songs")}>
                                <View class="leading-snug">
                                  <Text class={`truncate text-[13px] font-medium ${r.blocked ? "text-danger-soft-fg" : "text-foreground"}`}>{song.song_name}</Text>
                                  <If when={!!r.sub}>
                                    <Text class={`truncate text-[11px] ${r.blocked ? "text-danger-soft-fg" : "text-faint"}`}>{r.sub}</Text>
                                  </If>
                                </View>
                              </View>
                              <View class="w-[72px] px-2"><Text class="text-xs text-faint">{clock(song.send_time)}</Text></View>
                              <View class="w-[110px] flex-row items-center justify-end gap-1 px-2" style={{ opacity: 0.6 }} hoverStyle={{ opacity: 1 }}>
                                <If when={pluginEnabled() && !!kugou()}>
                                  {IconButton({
                                    testID: `song-add-${r.i}`,
                                    name: pending ? "loader" : "list-plus",
                                    label: "加入歌单",
                                    disabled: !canAdd,
                                    iconStyle: pending ? spinMotion.style : undefined,
                                    onPress: () => addTrackToPlayed(song),
                                    class: "h-7 w-7 rounded-[6px] bg-transparent active:bg-muted",
                                    iconClass: "h-3.5 w-3.5",
                                    color: "muted-foreground",
                                  })}
                                </If>
                                {IconButton({ testID: `song-copy-${r.i}`, name: "copy", label: "复制歌名", onPress: () => copyText(song.song_name, `歌名：${song.song_name}`), class: "h-7 w-7 rounded-[6px] bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5", color: "muted-foreground" })}
                                {IconButton({ testID: `song-del-${r.i}`, name: "trash", label: "删除", onPress: () => removeSong(song), class: "h-7 w-7 rounded-[6px] bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5", color: "muted-foreground" })}
                              </View>
                            </View>
                          );
                      })}
                    </View>
                  </Scroll>
                </View>
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
                    {Icon({ scheme: colorScheme(), name: "search", class: "h-3.5 w-3.5", color: "faint" })}
                    <Input style={inputStyle()}
                      value={playedQuery()}
                      onChange={({ value }) => playedQuery.set(value)}
                      placeholder="搜索歌曲名或用户…"
                      class="h-6 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs"
                    />
                    <If when={playedQuery()}>
                      {IconButton({ testID: "played-clear-query", name: "x", label: "清除搜索", onPress: () => playedQuery.set(""), class: "h-6 w-6 rounded-(--radius) bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5", color: "faint" })}
                    </If>
                  </View>
                </View>
              </If>
              <If when={filteredPlayed().length === 0} else={
                <View class="min-h-0 flex-1 flex-col">
                  <View class="h-8 shrink-0 flex-row items-center border-b border-line bg-secondary">
                    <View class="w-[40px] items-end pr-3"><Text class="text-xs font-medium text-muted-foreground">#</Text></View>
                    <View class="w-[80px] px-2"><Text class="text-xs font-medium text-muted-foreground">时间</Text></View>
                    <View class="w-[110px] px-2"><Text class="text-xs font-medium text-muted-foreground">用户</Text></View>
                    <View class="min-w-0 flex-1 px-2"><Text class="text-xs font-medium text-muted-foreground">点歌</Text></View>
                    <View class="w-[48px] px-2" />
                  </View>
                  <Scroll class="min-h-0 flex-1">
                    <View class="w-full">
                      {playedRows().map((r) => {
                          const song = r.song;
                          const entry = kgCache()[song.song_name.trim()];
                          const found = entry?.status === "found" ? entry.track : null;
                          return (
                            <View class="h-12 w-full flex-row items-center border-b border-line" hoverStyle={{ backgroundColor: token("muted") }}>
                              <View class="w-[40px] items-end pr-3"><Text class="text-xs text-faint">{r.i + 1}</Text></View>
                              <View class="w-[80px] px-2"><Text class="text-xs text-faint">{clock(song.played_at)}</Text></View>
                              <View class="w-[110px] px-2"><Text class="truncate text-xs text-muted-foreground">{song.uname || "?"}</Text></View>
                              <View class="min-w-0 flex-1 px-2" onContextMenu={(e: any) => openRowMenu(e, song, "played")}>
                                <View class="leading-snug">
                                  <Text class="truncate text-[13px] font-medium text-foreground">{song.song_name}</Text>
                                  <Text class="truncate text-[11px] text-faint">{found && pluginEnabled() ? `${platformName()}: ${found.artist || "未知歌手"}` : "已点"}</Text>
                                </View>
                              </View>
                              <View class="w-[48px] flex-row items-center justify-end px-2" style={{ opacity: 0.6 }} hoverStyle={{ opacity: 1 }}>
                                {IconButton({ testID: `played-copy-${r.i}`, name: "copy", label: "复制歌名", onPress: () => copyText(song.song_name, `歌名：${song.song_name}`), class: "h-7 w-7 rounded-[6px] bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5", color: "muted-foreground" })}
                              </View>
                            </View>
                          );
                      })}
                    </View>
                  </Scroll>
                </View>
              }>
                <View class="flex-1 items-center justify-center">
                  <Text class="text-sm text-faint">{playedQuery() ? "没有匹配的歌曲" : pluginEnabled() ? "暂无已点歌曲" : "仅弹幕监听：启用平台并加入歌单后，歌曲会出现在这里"}</Text>
                </View>
              </If>
            </If>

            <If when={activeTab() === "blacklist"}>
              <View class="flex-1 flex-col min-h-0">
                <View class="flex-row items-center gap-2 border-b border-line bg-card px-3 py-2 shrink-0">
                  <View class="flex-row gap-1">
                    <Button testID="black-type-song" onPress={() => blackType.set("song")} class={`items-center justify-center h-8 rounded-[6px] px-2 ${blackType() === "song" ? "bg-primary" : "border border-line-strong bg-card active:bg-muted"}`}>
                      <Text class={`text-[11px] ${blackType() === "song" ? "text-primary-foreground" : "text-foreground"}`}>歌曲</Text>
                    </Button>
                    <Button testID="black-type-singer" onPress={() => blackType.set("singer")} class={`items-center justify-center h-8 rounded-[6px] px-2 ${blackType() === "singer" ? "bg-primary" : "border border-line-strong bg-card active:bg-muted"}`}>
                      <Text class={`text-[11px] ${blackType() === "singer" ? "text-primary-foreground" : "text-foreground"}`}>歌手</Text>
                    </Button>
                  </View>
                  <Input style={inputStyle()}
                    value={blackInput()}
                    onChange={({ value }) => blackInput.set(value)}
                    onSubmit={addBlack}
                    placeholder={blackType() === "song" ? "输入歌曲名…" : "输入歌手名…"}
                    class="h-8 min-w-0 flex-1 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                  {IconButton({ testID: "black-add", name: "plus", onPress: addBlack, class: "h-8 w-8 rounded-(--radius) border border-line-strong bg-card active:bg-muted", iconClass: "h-4 w-4", label: "加入黑名单" })}
                </View>
                <If when={blackRows().length === 0} else={
                  <View class="flex-1 flex-col min-h-0">
                    <View class="flex-row items-center border-b border-line bg-secondary px-4 py-2 shrink-0">
                      <Text class="w-12 text-xs font-medium text-muted-foreground">类型</Text>
                      <Text class="flex-1 text-xs font-medium text-muted-foreground">歌曲名</Text>
                      <Text class="w-28 text-xs font-medium text-muted-foreground">歌手</Text>
                      <Text class="w-24 text-right text-xs font-medium text-muted-foreground">添加时间</Text>
                      <View class="w-10" />
                    </View>
                    <Scroll class="flex-1">
                      <Each of={blackRows()} key={(r: any) => r.key}>
                        {(item: any, index: any) => (
                          <View class="group flex-row items-center border-b border-line px-4 py-2 hover:bg-muted">
                            <View class="w-12 flex-row">
                              {/* The pill is the wrapper: a background on the
                                  Text itself is measured narrower than the
                                  glyphs at this size and clips 「曲」/「手」. */}
                              <View class="rounded bg-muted px-1.5 py-0.5">
                                <Text class="text-[11px] font-medium text-muted-foreground">{item().type === "singer" ? "歌手" : "歌曲"}</Text>
                              </View>
                            </View>
                            <Text class="flex-1 truncate text-sm text-foreground">{item().type === "singer" ? "全部歌曲" : item().name}</Text>
                            <Text class="w-28 truncate text-xs text-muted-foreground">{item().singer}</Text>
                            <Text class="w-24 text-right text-xs text-faint">{item().stamp}</Text>
                            <View class="w-10 items-end">
                              {IconButton({ testID: `black-remove-${index()}`, name: "x", onPress: () => removeBlack(item().key), class: "h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5", color: "danger-soft-fg", label: "移出黑名单" })}
                            </View>
                          </View>
                        )}
                      </Each>
                    </Scroll>
                  </View>
                }>
                  <View class="flex-1 items-center justify-center gap-2 py-16">
                    <Text class="text-sm text-faint">黑名单为空</Text>
                    <Text class="text-xs text-faint">{pluginEnabled() ? "歌曲名精确屏蔽；歌手名屏蔽酷狗搜索到的所有歌曲" : "歌曲名精确屏蔽；歌手名需在启用平台并匹配到酷狗歌曲后生效"}</Text>
                  </View>
                </If>
              </View>
            </If>
          </View>

          <If when={logVisible() && logs().length > 0}>
            <View class="shrink-0 border-t border-line bg-card">
              <View class="flex-row items-center bg-secondary px-3 py-[6px]">
                <Button onPress={() => logOpen.update((v) => !v)} class="flex-1 flex-row items-center gap-2 bg-transparent p-0 active:bg-transparent">
                  <Text class="text-[12px] font-medium text-muted-foreground">日志</Text>
                  <View class="ml-1 flex-row"><View class="rounded bg-muted px-1.5"><Text class="font-mono text-[10px] text-faint">{logs().length}</Text></View></View>
                </Button>
                {IconButton({ testID: "log-copy", name: "copy", label: "复制日志", text: "复制", textClass: "text-[11px] text-faint", iconClass: "h-3 w-3", color: "faint", onPress: () => copyText(logs().join("\n"), `日志 ${logs().length} 行`), class: "h-6 rounded px-1.5 bg-transparent active:bg-muted" })}
                {IconButton({ testID: "log-clear", name: "trash", label: "清空日志", text: "清空", textClass: "text-[11px] text-faint", iconClass: "h-3 w-3", color: "faint", onPress: () => { logs.set([]); showFlash("日志已清空"); }, class: "h-6 rounded px-1.5 bg-transparent active:bg-danger-soft-bg" })}
                {IconButton({ testID: "log-chevron", name: "chevron", label: "展开或收起日志", onPress: () => logOpen.update((v) => !v), class: "ml-1 h-6 w-6 rounded bg-transparent active:bg-muted", iconClass: `h-3.5 w-3.5 ${logOpen() ? "rotate-180" : ""}`, color: "faint" })}
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
            <If when={sessionStart() > 0 && nowTick() >= sessionStart()}>
              <View class="inline-flex items-baseline gap-1"><Text class="text-faint">时长</Text><Text class="tabular-nums text-foreground">{formatDuration(nowTick() - sessionStart())}</Text></View>
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
            <If when={pluginEnabled() && kugou()} else={<View class="h-2 w-2 rounded-full bg-faint" />}>
              <Text class="text-[11px] text-success">✓</Text>
            </If>
            <Text class="text-[11px] text-faint">{
              pluginEnabled() ? (kugou() ? "酷狗服务就绪" : "酷狗未登录")
              : config().active_plugin === "netease" ? "网易云音乐未接入"
              : "未启用平台插件"
            }</Text>
          </View>
        </View>
      </View>

      <Dialog
        open={settingsOpen()}
        onOpenChange={({ open }: any) => settingsOpen.set(open)}
        class="m-auto w-[560px] rounded-(--radius) border border-line bg-card shadow-2xl"
        backdropClass="bg-overlay"
      >
        <View class="h-[520px]">
          <View class="h-[48px] flex-row items-center border-b border-line px-4">
            <Text class="text-[14px] font-semibold text-foreground">设置</Text>
            <View class="flex-1" />
            <Button testID="settings-close" onPress={() => settingsOpen.set(false)} class="items-center justify-center rounded-[6px] border border-line-strong px-3 py-1 active:bg-background">
              <Text class="text-[12px] text-foreground">关闭</Text>
            </Button>
          </View>
          <View class="h-10 flex-row items-center gap-1 border-b border-line px-4">
            <Each of={(["general", "plugin", "about"] as const)} key={(t: any) => t}>
              {(tab: any) => (
                <Button
                  testID={`settings-tab-${tab()}`}
                  onPress={() => settingsTab.set(tab())}
                  class={`h-9 items-center justify-center rounded-none border-0 border-b-2 bg-transparent px-3 ${settingsTab() === tab() ? "border-foreground" : "border-transparent"}`}
                >
                  <Text class={`text-[12px] font-medium ${settingsTab() === tab() ? "text-foreground" : "text-muted-foreground"}`}>
                    {tab() === "general" ? "常规" : tab() === "plugin" ? "插件" : "关于"}
                  </Text>
                </Button>
              )}
            </Each>
          </View>
          <Scroll class="flex-1 p-4">
            <View class="gap-3">
              <If when={settingsTab() === "general"}>
                <View class="gap-3">
                  <Text class="text-[13px] font-semibold text-foreground">外观</Text>
                  <View class="flex-row gap-2">
                    <Each of={(["system", "light", "dark"] as const)} key={(m: any) => m}>
                      {(mode: any) => (
                        <Button
                          onPress={() => applyTheme(mode())}
                          class={`items-center justify-center rounded-[6px] px-3 py-1 ${themeMode() === mode() ? "bg-primary" : "border border-line-strong active:bg-background"}`}
                        >
                          <Text class={`text-[11px] ${themeMode() === mode() ? "text-primary-foreground" : "text-foreground"}`}>
                            {mode() === "system" ? "跟随系统" : mode() === "light" ? "亮色" : "暗色"}
                          </Text>
                        </Button>
                      )}
                    </Each>
                  </View>
                  <View class="h-px bg-muted" />
                  <View class="flex-row items-center justify-between gap-3">
                    <View class="flex-1 gap-0.5">
                      <Text class="text-[13px] text-foreground">显示日志面板</Text>
                      <Text class="text-[11px] text-faint">默认隐藏；打开后底部出现日志条，可复制、清空、展开</Text>
                    </View>
                    <Button
                      testID="log-toggle"
                      onPress={() => setLogVisible(!logVisible())}
                      class={`items-center justify-center rounded-[6px] px-3 py-1 ${logVisible() ? "bg-primary" : "border border-line-strong active:bg-background"}`}
                    >
                      <Text class={`text-[11px] ${logVisible() ? "text-primary-foreground" : "text-foreground"}`}>
                        {logVisible() ? "已显示" : "已隐藏"}
                      </Text>
                    </Button>
                  </View>
                  <View class="h-px bg-muted" />
                  <Text class="text-[13px] font-semibold text-foreground">运行信息</Text>
                  <View class="gap-1 rounded-[6px] border border-line px-3 py-2">
                    <Text class="text-[12px] text-muted-foreground">直播间 ID：{config().room_id || "—"}</Text>
                    <Text class="text-[12px] text-muted-foreground">版本：v{APP_VERSION}</Text>
                    <Text class="text-[12px] text-muted-foreground">运行要求：Windows 10 1809+ / macOS 14+</Text>
                  </View>
                  <Text class="text-[11px] text-faint">直播间配置与点歌规则始终在左侧（弹幕监听）；歌单名、清理、自动同步与手动点歌仅在启用酷狗音乐后出现；平台选择与登录在插件页。</Text>
                  <Button testID="go-plugin" onPress={() => settingsTab.set("plugin")} class="items-center justify-center self-start rounded-[6px] border border-line-strong bg-card px-3 py-1.5 active:bg-muted">
                    <Text class="text-[12px] text-foreground">前往插件设置 →</Text>
                  </Button>
                </View>
              </If>
              <If when={settingsTab() === "plugin"}>
                <View class="gap-3">

              <Text class="text-[13px] font-semibold text-foreground">插件</Text>
              <Text class="text-[11px] text-faint">可选一个平台，也可以都不开；歌单、自动同步与歌曲匹配只随所选平台显示。</Text>
              <Text class="text-[11px] text-faint">插件是数据目录下 plugins/&lt;id&gt;/ 的一个文件夹（plugin.json + 一个 JS 模块），在隐藏的 WebView 里运行。可安装、启用、移除；同一时间只启用一个平台。</Text>

              {/* 酷狗音乐：平台插件，选中它才启用平台 */}
              <View class={`gap-2 rounded-[6px] border px-3 py-2 ${pluginEnabled() ? "border-primary bg-accent-soft-bg" : "border-line"}`}>
                <View class="flex-row items-center gap-2">
                  <View class={`h-3 w-3 rounded-full border ${pluginEnabled() ? "border-primary bg-primary" : "border-line-strong"}`} />
                  <View class="flex-1">
                    <Text class="text-[13px] text-foreground">酷狗音乐</Text>
                    <Text class="text-[11px] text-faint">{KUGOU_WEB_MANIFEST.version} · {KUGOU_WEB_MANIFEST.note}</Text>
                  </View>
                  <If when={!kugouInstalled()}>
                    <Button testID="kw-install" onPress={installKugouPlugin} class="items-center justify-center rounded-[6px] bg-primary px-3 py-1 active:opacity-80">
                      <Text class="text-[11px] text-primary-foreground">安装</Text>
                    </Button>
                  </If>
                  <If when={kugouInstalled()}>
                    <Button
                      testID={platformTestId("kugou-web")}
                      onPress={() => selectPlugin("kugou-web")}
                      class={`items-center justify-center rounded-[6px] px-3 py-1 ${pluginEnabled() ? "bg-primary" : "border border-line-strong active:bg-background"}`}
                    >
                      <Text class={`text-[12px] ${pluginEnabled() ? "text-primary-foreground" : "text-foreground"}`}>
                        {pluginEnabled() ? "停用" : "启用"}
                      </Text>
                    </Button>
                    <Button
                      testID="kw-remove"
                      onPress={() => uninstallPlugin(KUGOU_WEB_MANIFEST.id)}
                      class="items-center justify-center rounded-[6px] border border-line-strong px-2 py-1 active:bg-background"
                    >
                      <Text class="text-[11px] text-foreground">移除</Text>
                    </Button>
                  </If>
                </View>
                <If when={config().active_plugin === "kugou-web" && !plugins().some((p: any) => p.manifest.id === KUGOU_WEB_MANIFEST.id)}>
                  <Text class="text-[11px] text-[#c5403c]">插件未安装：请先点「安装」。</Text>
                </If>

                <If when={pluginEnabled()}>
                  <View class="h-px bg-muted" />
                  <Text class="text-[12px] font-semibold text-foreground">酷狗登录</Text>
                  <If when={!kugou()}>
                    <View class="gap-2">
                      <Button testID="kw-login" onPress={startLogin} class="items-center justify-center self-start rounded-[6px] bg-primary px-3 py-2 active:opacity-80">
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
                        <Button onPress={logout} class="items-center justify-center rounded-[6px] border border-line-strong px-2 py-1 active:bg-background">
                          <Text class="text-[11px] text-foreground">退出登录</Text>
                        </Button>
                      </View>
                      <Text class="text-[11px] text-faint">{kgMsg()}</Text>
                    </View>
                  </If>

                  <View class="h-px bg-muted" />
                  <Text class="text-[12px] font-semibold text-foreground">平台接口（经插件）</Text>
                  <View class="flex-row items-center gap-2">
                    <Input style={inputStyle()} value={kwQuery()} onChange={({ value }: any) => kwQuery.set(value)} placeholder="搜索歌名" class="flex-1" />
                    <Button testID="kw-search" onPress={() => { kwSearch(); }} class="items-center justify-center rounded-[6px] border border-line-strong bg-card px-3 py-1.5 active:bg-muted">
                      <Text class="text-[12px] text-foreground">搜索</Text>
                    </Button>
                    <Button testID="kw-add" onPress={kwAdd} class="items-center justify-center rounded-[6px] border border-line-strong bg-card px-3 py-1.5 active:bg-muted">
                      <Text class="text-[12px] text-foreground">加入歌单</Text>
                    </Button>
                    <Button testID="kw-selftest" onPress={kwSelfTest} class="items-center justify-center rounded-[6px] border border-line-strong bg-card px-3 py-1.5 active:bg-muted">
                      <Text class="text-[12px] text-foreground">自检</Text>
                    </Button>
                    <Button testID="kw-playlists" onPress={kwPlaylists} class="items-center justify-center rounded-[6px] border border-line-strong bg-card px-3 py-1.5 active:bg-muted">
                      <Text class="text-[12px] text-foreground">歌单列表</Text>
                    </Button>
                  </View>
                  <If when={kwQr()}>
                    <Image src={kwQr()!} class="h-[140px] w-[140px] rounded-[6px] border border-line" />
                  </If>
                  <Text testID="kw-status" class="text-[11px] text-muted-foreground">{kwStatus()}</Text>
                </If>
              </View>
              <If when={!config().active_plugin}>
                <Text class="text-[11px] text-faint">未选择平台：仅弹幕监听并收集点歌指令；歌单、自动同步、歌曲匹配与手动点歌均已隐藏。</Text>
              </If>

              {/* 其它插件：装与不装都与平台无关 */}
              <Text class="text-[12px] font-semibold text-foreground">其它插件</Text>
              <View class="flex-row items-center gap-2">
                <Button testID="plugin-install-demo" onPress={installDemoPlugin} class="items-center justify-center rounded-[6px] border border-line-strong bg-card px-3 py-1.5 active:bg-muted">
                  <Text class="text-[12px] text-foreground">安装示例插件</Text>
                </Button>
                <Button testID="plugin-rescan" onPress={refreshPlugins} class="items-center justify-center rounded-[6px] border border-line-strong bg-card px-3 py-1.5 active:bg-muted">
                  <Text class="text-[12px] text-foreground">重新扫描</Text>
                </Button>
              </View>
              <If when={plugins().filter((p: any) => p.manifest.id !== KUGOU_WEB_MANIFEST.id).length === 0}>
                <Text class="text-[11px] text-faint">还没有其它插件。安装示例插件即可看到完整链路（安装 → 启用 → 调用）。</Text>
              </If>
              <Each of={plugins().filter((p: any) => p.manifest.id !== KUGOU_WEB_MANIFEST.id)} key={(p: any) => p.manifest.id}>
                {(item: any) => (
                  <View class="gap-1.5 rounded-[6px] border border-line px-3 py-2">
                    <View class="flex-row items-center gap-2">
                      <Text class="text-[13px] text-foreground">{item().manifest.name}</Text>
                      <Text class="text-[11px] text-faint">v{item().manifest.version} · api {item().manifest.api}</Text>
                      <View class="flex-1" />
                      <Button
                        testID={`plugin-toggle-${item().manifest.id}`}
                        onPress={() => togglePlugin(item().manifest.id)}
                        class={`items-center justify-center rounded-[6px] px-2 py-1 ${pluginsOn()[item().manifest.id] ? "bg-primary" : "border border-line-strong active:bg-background"}`}
                      >
                        <Text class={`text-[11px] ${pluginsOn()[item().manifest.id] ? "text-primary-foreground" : "text-foreground"}`}>
                          {item().blocked ? "不可用" : pluginsOn()[item().manifest.id] ? "停用" : "启用"}
                        </Text>
                      </Button>
                      <Button
                        testID={`plugin-remove-${item().manifest.id}`}
                        onPress={() => uninstallPlugin(item().manifest.id)}
                        class="items-center justify-center rounded-[6px] border border-line-strong px-2 py-1 active:bg-background"
                      >
                        <Text class="text-[11px] text-foreground">移除</Text>
                      </Button>
                    </View>
                    <Text class="text-[11px] text-faint">{item().manifest.note ?? ""}</Text>
                    <If when={item().blocked}>
                      <Text testID={`plugin-blocked-${item().manifest.id}`} class="text-[11px] text-[#c5403c]">{item().blocked}；该插件不加载，文件夹保留。</Text>
                    </If>
                    <View class="flex-row items-center gap-2">
                      <Button testID={`plugin-hello-${item().manifest.id}`} onPress={() => callPlugin(item().manifest.id, "hello", {})} class="items-center justify-center rounded-[6px] border border-line-strong px-2 py-1 active:bg-background">
                        <Text class="text-[11px] text-foreground">调用 hello</Text>
                      </Button>
                      <Button testID={`plugin-search-${item().manifest.id}`} onPress={() => callPlugin(item().manifest.id, "search", { q: "晴天" })} class="items-center justify-center rounded-[6px] border border-line-strong px-2 py-1 active:bg-background">
                        <Text class="text-[11px] text-foreground">调用 search</Text>
                      </Button>
                      <Text class="flex-1 text-[11px] text-muted-foreground">{pluginStatus()[item().manifest.id] ?? ""}</Text>
                    </View>
                  </View>
                )}
              </Each>

              <View class="gap-1 rounded-[6px] border border-line px-3 py-2">
                <Text class="text-[13px] text-foreground">网易云音乐</Text>
                <Text class="text-[11px] text-faint">未接入 · 启用后歌单与歌曲匹配暂不可用</Text>
              </View>
                </View>
              </If>
              <If when={settingsTab() === "about"}>
                <View class="gap-3">
                  <View class="flex-row items-center gap-3">
                    <Image src={logo} class="h-10 w-10 rounded-[4px]" />
                    <View class="flex-1">
                      <Text class="text-[14px] font-semibold text-foreground">SUSUSongBoard</Text>
                      <Text class="text-[11px] text-faint">v{APP_VERSION}</Text>
                    </View>
                  </View>
                  <View class="h-px bg-line" />
                  <Text class="text-[12px] text-muted-foreground">抖音直播间点歌看板，原生渲染，无需 Node 侧车；只有在启用插件时才会用到系统 WebView。</Text>
                  <Text class="text-[11px] text-faint">仓库：{APP_REPO} · 分支 nsh</Text>
                  <Text class="text-[11px] text-faint">运行要求：Windows 10 1809+ / macOS 14+</Text>
                  <View class="flex-row items-center gap-2">
                    <Button testID="about-update" onPress={checkUpdate} class="items-center justify-center rounded-[6px] bg-primary px-3 py-2 active:opacity-80">
                      <Text class="text-[12px] text-primary-foreground">{aboutBusy() && updateProgress() === null ? "处理中…" : "检查更新"}</Text>
                    </Button>
                    <If when={updateInfo()}>
                      <Button testID="about-install" onPress={installUpdate} class="items-center justify-center rounded-[6px] border border-line-strong bg-card px-3 py-2 active:bg-muted">
                        <Text class="text-[12px] text-foreground">{updateInfo()?.canInstall ? "下载并安装" : "打开下载页"}</Text>
                      </Button>
                    </If>
                  </View>
                  <Text class="text-[11px] text-muted-foreground">{aboutMsg()}</Text>
                  <If when={updateProgress() !== null}>
                    <View class="gap-1">
                      <View class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <View class="h-full rounded-full bg-primary" style={{ width: `${Math.round((updateProgress() ?? 0) * 100)}%` }} />
                      </View>
                      <Text testID="about-progress" class="text-[10px] text-faint">下载中 {Math.round((updateProgress() ?? 0) * 100)}%</Text>
                    </View>
                  </If>
                  <Text testID="about-update-source" class="text-[10px] text-faint">更新源：gh-proxy.com（清单验签、包校验 SHA-256；失败时保持当前版本）</Text>
                </View>
              </If>
            </View>
          </Scroll>
        </View>
      </Dialog>

      {/* First-run import dialog: shown when no NSH config exists */}
      <Dialog
        open={showFirstRunImport()}
        onOpenChange={({ open }: any) => showFirstRunImport.set(open)}
        class="m-auto w-[560px] rounded-(--radius) border border-line bg-card shadow-2xl"
        backdropClass="bg-overlay"
      >
        <View class="h-[520px]">
          <View class="h-[48px] flex-row items-center border-b border-line px-4">
            <Text class="text-[14px] font-semibold text-foreground">欢迎使用 SUSUSongBoard</Text>
            <View class="flex-1" />
            <Button testID="firstrun-close" onPress={() => showFirstRunImport.set(false)} class="items-center justify-center rounded-[6px] border border-line-strong px-3 py-1 active:bg-background">
              <Text class="text-[12px] text-foreground">跳过</Text>
            </Button>
          </View>
          <Scroll class="flex-1 p-4">
            <View class="gap-4">
              <View class="gap-2 rounded-[6px] border border-line bg-secondary px-3 py-2">
                <Text class="text-[13px] font-medium leading-5 text-foreground">仅弹幕监听模式</Text>
                <Text class="text-[11px] leading-4 text-muted-foreground">
                  检测到这是首次运行，且未检测到可自动导入的旧数据。
                  当前处于「仅弹幕监听」模式：点歌指令只收集到「点歌列表」，
                  不会同步到歌单，也无法使用手动点歌、歌单管理与自动同步。
                </Text>
                <Text class="text-[11px] text-faint">如需完整功能，请在插件页启用「酷狗音乐」。</Text>
              </View>
              <View class="gap-2">
                <Button testID="firstrun-enable-kugou" onPress={() => { selectPlugin("kugou-web"); showFirstRunImport.set(false); }} class="items-center justify-center self-start w-full rounded-[6px] border border-line-strong bg-card px-3 py-2 active:bg-muted">
                  <Text class="text-[12px] text-foreground">启用酷狗音乐，开始完整体验</Text>
                </Button>
                <Button testID="firstrun-continue-listener" onPress={() => showFirstRunImport.set(false)} class="items-center justify-center self-start w-full rounded-[6px] border border-line-strong bg-card px-3 py-2 active:bg-muted">
                  <Text class="text-[12px] text-foreground">继续仅弹幕监听模式</Text>
                </Button>
              </View>
            </View>
          </Scroll>
        </View>
      </Dialog>

      <Overlay style={{ position: "fixed", right: 16, bottom: 16 }}>
        <ToastStack
          class="w-[300px]"
          placement="bottomRight"
          onExpandedChange={({ expanded }: { expanded: boolean }) => toastExpanded.set(expanded)}
        >
          {(toastTick(), toasts.visible(4).map((entry) => {
            const value = entry.value as { msg: string; tone: string };
            return (
              <Toast
                key={entry.id}
                transitionStatus={entry.status}
                accessibilityLabel={value.msg}
                swipeDirection="right"
                onDismissRequest={() => {
                  toasts.dismiss(entry.id);
                  toastTick.update((v) => v + 1);
                }}
              >
                <View class={`mb-2 flex-row items-center gap-2 rounded-[6px] border bg-card px-3 py-2 shadow-md ${value.tone === "error" ? "border-[#c5403c]" : "border-line"}`}>
                  <View class={`h-[6px] w-[6px] shrink-0 rounded-full ${value.tone === "error" ? "bg-[#c5403c]" : value.tone === "success" ? "bg-success" : "bg-primary"}`} />
                  <Text class="flex-1 text-[12px] leading-4 text-foreground">{value.msg}</Text>
                </View>
              </Toast>
            );
          }))}
        </ToastStack>
      </Overlay>

      <Each of={plugins().filter((p: any) => isPluginRunning(p.manifest.id) && !p.blocked)} key={(p: any) => p.manifest.id}>
        {(item: any) => (
          <PluginView
            plugin={item()}
            channel={channelFor(item())}
            onError={(line: string) => log(line)}
          />
        )}
      </Each>

    </View>
  );
}
mount(Board);
