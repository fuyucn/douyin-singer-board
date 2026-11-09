import { Clipboard, colorScheme, effect, Image, mount, Scroll, setColorScheme, signal, Storage, Text, token, View } from "nsh";
import { Icon, IconButton } from "./ui";
import icon from "./assets/icon.png";
import logo from "./assets/logo.png";
import { Button, DataTable, Dialog, Input, type DataTableColumn } from "nsh/base";
import { checkForUpdate } from "nsh/updater";
import Client from "./listener-bundle.js";
import { Matcher } from "./src/matcher";
import { SyncLedger, formatDuration, isAuthFailure, nextDelay, pickNextSync, type SearchState } from "./src/autoSync";
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
const APP_VERSION = "0.6.3";
const APP_REPO = "fuyucn/douyin-singer-board";

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
    kugou_enabled: true,
    blacklist: [],
    blacklist_singers: [],
    blacklist_meta: {},
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
  const kgCache = signal<Record<string, SearchState>>({});
  const blackType = signal<"song" | "singer">("song");
  const aboutOpen = signal(false);
  const aboutMsg = signal("");
  const aboutBusy = signal(false);
  const nowTick = signal(Math.floor(Date.now() / 1000));
  let loginGen = 0;

  const matcher = new Matcher(config());
  effect(() => matcher.reload(config()));

  let configLoaded = false;
  Storage.getItem("board.config")
    .then((raw) => {
      if (raw) {
        try {
          const saved = JSON.parse(raw);
          // 0.5.x persisted kugou_enabled=false as a default even though the
          // flag was not wired up. Treat those configs as an upgrade and turn
          // the service on once; from v2 on the user's choice is respected.
          const legacy = saved.config_version !== 2;
          config.set({
            ...config(),
            ...saved,
            blacklist: Array.isArray(saved.blacklist) ? saved.blacklist : [],
            blacklist_singers: Array.isArray(saved.blacklist_singers) ? saved.blacklist_singers : [],
            blacklist_meta: saved.blacklist_meta && typeof saved.blacklist_meta === "object" ? saved.blacklist_meta : {},
            kugou_enabled: legacy || typeof saved.kugou_enabled !== "boolean" ? true : saved.kugou_enabled,
            config_version: 2,
          });
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
      const auth = isAuthFailure({ status: 0 }, String(e?.message ?? e));
      kgState.set(auth ? "expired" : "error");
      kgMsg.set(auth ? "酷狗登录已失效，请重新扫码" : "歌单加载失败: " + String(e?.message ?? e));
      log(auth ? "酷狗登录已失效" : "酷狗歌单加载失败");
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

  // --- Platform gating -----------------------------------------------------
  const pluginEnabled = () => config().active_plugin === "kugou" && config().kugou_enabled !== false;
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
    if (played().some((p) => p.msg_id === song.msg_id)) return;
    songs.update((v) => v.filter((s) => s.msg_id !== song.msg_id));
    played.update((v) => [{ ...song, played_at: Math.floor(Date.now() / 1000) }, ...v]);
    selectedRow.set(null);
    log(`已点: ${song.uname} - ${song.song_name}`);
  };

  const performSync = async (
    song: DanmuInfo,
    track: { name: string; artist: string; hash: string; albumId?: string; mixSongId?: string; duration?: number },
    key: string,
    gen: number,
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
        if (gen !== syncGen) {
          log(`酷狗自动加入 (切换前): ${track.name}`);
          return true;
        }
        syncFailures = 0;
        log(`酷狗自动加入: ${track.name}`);
        if (ledger.phase(key) === "synced") moveToPlayed(song);
        return true;
      }
      if (gen !== syncGen) {
        ledger.failed(key, String(res.msg ?? res.status), 10);
        return false;
      }
      const auth = isAuthFailure(res);
      syncFailures += 1;
      ledger.failed(key, String(res.msg ?? res.status), auth ? 3600 : nextDelay(syncFailures) / 1000);
      log(`酷狗自动加入失败: ${track.name} (${res.status})`);
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
    try {
      const update = await checkForUpdate();
      aboutMsg.set(update ? `发现新版本 ${update.version}` : "已是最新版本");
    } catch (e: any) {
      aboutMsg.set("暂无更新源：" + String(e?.message ?? e));
    } finally {
      aboutBusy.set(false);
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

  const songRows = () => {
    const cache = kgCache();
    return songs().map((s, i) => {
      const entry = pluginEnabled() ? cache[s.song_name.trim()] : undefined;
      const blocked = entry?.status === "found" ? blockedReason(entry.track) : null;
      const sub = blocked
        ? `黑名单 (${blocked === "singer" ? "歌手" : "歌曲"})`
        : entry?.status === "found" ? `酷狗: ${entry.track.artist || "未知歌手"}`
        : entry?.status === "pending" ? "酷狗搜索中…"
        : entry?.status === "not_found" ? "酷狗未找到"
        : entry?.status === "error" ? "酷狗搜索失败"
        : "手动添加";
      return {
        idx: String(i + 1),
        user: s.uname || "?",
        // DataTable only redraws a cell when that column's text changes, so
        // the status is suffixed here. renderCell draws the real title from
        // songs(), copy uses song_name, and no column is sortable.
        song: `${s.song_name}|${sub}`,
        time: clock(s.send_time),
        actions: "",
        sub,
        blocked,
      };
    });
  };

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
    const key = song.msg_id;
    const claimed = ledger.claim(key);
    if (!claimed) ledger.manual(key);
    moveToPlayed(song);

    const sess = kugou();
    const target = config().target_playlist_id;
    const shouldSync = claimed && pluginEnabled() && (config().auto_sync ?? false) && !!sess && !!target;
    if (!shouldSync) {
      if (claimed) ledger.manual(key);
      return;
    }
    const gen = syncGen;
    const entry = kgCache()[song.song_name.trim()];
    const cached = entry?.status === "found" ? entry.track : null;
    if (cached) {
      if (blockedReason(cached)) { log(`黑名单跳过: ${song.song_name}`); ledger.manual(key); return; }
      void performSync(song, cached, key, gen);
      return;
    }
    search({ keyword: song.song_name, pagesize: 3 })
      .then((tracks) => {
        const t = tracks[0];
        if (gen !== syncGen) return;
        if (!t) { log(`酷狗未找到: ${song.song_name}`); ledger.failed(key, "not found", 30); return; }
        void performSync(song, t, key, gen);
      })
      .catch((e: any) => {
        if (gen !== syncGen) return;
        ledger.failed(key, String(e?.message ?? e), 10);
        log("酷狗自动同步失败: " + String(e?.message ?? e));
      });
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
    const type = blackType();
    const key = `${type}:${name}`;
    const existing = type === "song" ? bl() : singers();
    if (existing.includes(name)) { log(`黑名单已有: ${name}`); return; }
    const meta = { ...(config().blacklist_meta ?? {}), [key]: Math.floor(Date.now() / 1000) };
    if (type === "song") patch({ blacklist: [...bl(), name], blacklist_meta: meta });
    else patch({ blacklist_singers: [...singers(), name], blacklist_meta: meta });
    blackInput.set("");
    log(`加入黑名单 (${type === "song" ? "歌曲" : "歌手"}): ${name}`);
  };

  const removeBlack = (key: string) => {
    const colon = key.indexOf(":");
    const type = key.slice(0, colon);
    const name = key.slice(colon + 1);
    if (type === "song") patch({ blacklist: bl().filter((s) => s !== name) });
    else patch({ blacklist_singers: singers().filter((s) => s !== name) });
    log(`移出黑名单: ${name}`);
  };

  const running = () => ["解析房间...", "连接中...", "已连接"].includes(status());

  const inputStyle = () => ({
    color: token("foreground"),
    placeholderColor: token("muted-foreground"),
    caretColor: token("primary"),
  });

  const tabButton = (key: Tab, label: string) => (
    <Button
      onPress={() => { activeTab.set(key); selectedRow.set(null); }}
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
          {IconButton({ testID: "settings", name: "settings", onPress: () => settingsOpen.set(true), label: "设置", class: "h-[30px] w-[30px] rounded-(--radius) bg-transparent text-muted-foreground active:bg-muted", iconClass: "h-[15px] w-[15px]" })}
          {IconButton({ testID: "about", name: "info", onPress: () => aboutOpen.set(true), label: "关于 / 检查更新", class: "h-[30px] w-[30px] rounded-(--radius) bg-transparent text-muted-foreground active:bg-muted", iconClass: "h-[15px] w-[15px]" })}
          <If when={running()} else={IconButton({ testID: "start", name: "play", onPress: start, class: "ml-2 mr-[1px] h-[30px] w-[30px] rounded-[6px] bg-foreground", iconClass: "h-[15px] w-[15px]", color: "background", label: "开始" })}>
            {IconButton({ testID: "stop", name: "square", onPress: stop, class: "ml-2 mr-[1px] h-[30px] w-[30px] rounded-[6px] bg-destructive", iconClass: "h-[15px] w-[15px]", color: "#ffffff", label: "停止" })}
          </If>
        </View>
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
                    {Icon({ scheme: colorScheme(), name: "info", class: "h-3 w-3", color: "faint" })}
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
                  <Text class="text-[11px] text-faint">同一首歌在冷却时间内不会重复加入歌单</Text>
                </View>
                <View class="gap-1.5">
                  <Text class="text-xs text-muted-foreground">单人单场点歌上限</Text>
                  <Input style={inputStyle()}
                    value={String(config().max_songs_per_user)}
                    onChange={({ value }) => patch({ max_songs_per_user: num(value) })}
                    class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                  />
                  <Text class="text-[11px] text-faint">每位观众本场最多自动点歌的首数（0 = 不限制）；手动加入不受限</Text>
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
                        onChange={({ value }) => patch({ target_playlist_name: value })}
                        placeholder="自动加入歌单的名字"
                        class="h-8 rounded-(--radius) border border-input bg-background px-2.5 text-sm"
                      />
                      <View class="flex-row gap-2">
                        <Button onPress={() => settingsOpen.set(true)} class="items-center justify-center h-8 flex-1 rounded-(--radius) border border-line-strong bg-card px-2.5 active:bg-muted">
                          <Text class="text-xs text-foreground">管理酷狗</Text>
                        </Button>
                        <Button
                          onPress={() => patch({ auto_sync: !(config().auto_sync ?? false) })}
                          class={`items-center justify-center h-8 flex-1 rounded-(--radius) px-2.5 ${config().auto_sync ? "bg-primary" : "border border-line-strong bg-card active:bg-muted"}`}
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

            <View class="mt-auto p-4 text-[11px] text-faint">
              <Text class="text-[11px] text-faint">SUSUSongBoard v{APP_VERSION}</Text>
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
                <Text class={`text-sm font-medium ${activeTab() === "blacklist" ? "text-foreground" : "text-muted-foreground"}`}>黑名单 ({blackRows().length})</Text>
              </Button>
            </View>
            <If when={activeTab() !== "blacklist" && (activeTab() === "songs" ? songs().length : played().length) > 0}>
              {IconButton({ geomKey: "clear-list", name: "trash", text: "清空列表", textClass: "text-xs text-muted-foreground", iconClass: "h-3.5 w-3.5", color: "muted-foreground", onPress: () => { if (activeTab() === "songs") { songs.set([]); selectedRow.set(null); } else { played.set([]); } }, class: "h-7 rounded-(--radius) bg-transparent px-2.5 active:bg-muted" })}
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
                    if (!song) return <Text class="text-sm text-foreground">{cell.text}</Text>;
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
                      const row = songRows()[cell.row];
                      const blocked = row?.blocked;
                      const sub = row?.sub ?? "手动添加";
                      return (
                        <View class="leading-snug">
                          <Text class={`truncate text-[13px] font-medium ${blocked ? "text-danger-soft-fg" : "text-foreground"}`}>{song.song_name}</Text>
                          <Text class={`truncate text-[11px] ${blocked ? "text-danger-soft-fg" : "text-faint"}`}>{sub}</Text>
                        </View>
                      );
                    }
                    if (cell.key === "time") return <Text class="text-xs text-faint">{clock(song.send_time)}</Text>;
                    if (cell.key === "actions") {
                      return (
                        <View class="flex-row justify-end gap-1 opacity-60">
                          {IconButton({ geomKey: `song-copy-${cell.row}`, name: "copy", onPress: () => { Clipboard.writeText(song.song_name); log(`已复制: ${song.song_name}`); }, class: "h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5" })}
                          {IconButton({ testID: `mark-${cell.row}`, name: "check", onPress: () => markPlayed(cell.row), class: "h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5", label: "标记已点" })}
                          {IconButton({ testID: `delete-${cell.row}`, name: "trash", onPress: () => removeSong(cell.row), class: "h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5", color: "danger-soft-fg", label: "删除" })}
                        </View>
                      );
                    }
                    return <Text class="text-sm text-foreground">{cell.text}</Text>;
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
                    {Icon({ scheme: colorScheme(), name: "search", class: "h-3.5 w-3.5", color: "faint" })}
                    <Input style={inputStyle()}
                      value={playedQuery()}
                      onChange={({ value }) => playedQuery.set(value)}
                      placeholder="搜索歌曲名或用户…"
                      class="h-6 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs"
                    />
                    <If when={playedQuery()}>
                      {IconButton({ geomKey: "played-clear-query", name: "x", onPress: () => playedQuery.set(""), class: "h-6 w-6 rounded-(--radius) bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5", color: "faint" })}
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
                  if (!song) return <Text class="text-sm text-foreground">{cell.text}</Text>;
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
                      {IconButton({ geomKey: `played-copy-${cell.row}`, name: "copy", onPress: () => { Clipboard.writeText(song.song_name); log(`已复制: ${song.song_name}`); }, class: "h-7 w-7 rounded-(--radius) bg-transparent active:bg-muted", iconClass: "h-3.5 w-3.5" })}
                    </View>
                  );
                  return <Text class="text-sm text-foreground">{cell.text}</Text>;
                }}
                empty={<Text class="text-sm text-faint">{playedQuery() ? "没有匹配的歌曲" : "暂无已点歌曲"}</Text>}
              />
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
                            <View class="w-12">
                              <Text class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{item().type === "singer" ? "歌手" : "歌曲"}</Text>
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
                    <Text class="text-xs text-faint">歌曲名精确屏蔽；歌手名屏蔽酷狗搜索到的所有歌曲</Text>
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
                {IconButton({ geomKey: "log-copy", name: "copy", text: "复制", textClass: "text-[11px] text-faint", iconClass: "h-3 w-3", color: "faint", onPress: () => { Clipboard.writeText(logs().join("\n")); log("日志已复制"); }, class: "h-6 rounded px-1.5 bg-transparent active:bg-muted" })}
                {IconButton({ geomKey: "log-clear", name: "trash", text: "清空", textClass: "text-[11px] text-faint", iconClass: "h-3 w-3", color: "faint", onPress: () => logs.set([]), class: "h-6 rounded px-1.5 bg-transparent active:bg-danger-soft-bg" })}
                {IconButton({ geomKey: "log-chevron", name: "chevron", onPress: () => logOpen.update((v) => !v), class: "ml-1 h-6 w-6 rounded bg-transparent active:bg-muted", iconClass: `h-3.5 w-3.5 ${logOpen() ? "rotate-180" : ""}`, color: "faint" })}
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
            <Button onPress={() => settingsOpen.set(false)} class="items-center justify-center rounded-[6px] border border-line-strong px-3 py-1 active:bg-background">
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
              <Text class="text-[13px] font-semibold text-foreground">平台插件</Text>
              <Text class="text-[11px] text-faint">同一时间只启用一个平台插件；切换后另一个平台的登录与自动同步会停用。</Text>
              <View class="flex-row items-center gap-2 rounded-[6px] border border-line px-3 py-2">
                <View class="flex-1">
                  <Text class="text-[12px] text-foreground">启用酷狗服务</Text>
                  <Text class="text-[11px] text-faint">停用后预搜索、歌单与后台自动同步全部停止</Text>
                </View>
                <Button testID="kugou-toggle" onPress={() => patch({ kugou_enabled: !config().kugou_enabled })} class={`items-center justify-center rounded-[6px] px-3 py-1 ${config().kugou_enabled ? "bg-primary" : "border border-line-strong active:bg-background"}`}>
                  <Text class={`text-[12px] ${config().kugou_enabled ? "text-primary-foreground" : "text-foreground"}`}>{config().kugou_enabled ? "已启用" : "已停用"}</Text>
                </Button>
              </View>
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
                        class={`items-center justify-center rounded-[6px] px-3 py-1 ${config().active_plugin === item().id ? "bg-primary" : "border border-line-strong active:bg-background"}`}
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
              <If when={pluginEnabled()}>
                <Text class="text-[13px] font-semibold text-foreground">管理酷狗音乐</Text>
                <If when={!kugou()}>
                  <View class="gap-2">
                    <Button onPress={startLogin} class="items-center justify-center self-start rounded-[6px] bg-primary px-3 py-2 active:opacity-80">
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

                    <View class="flex-row items-center gap-2">
                      <Text class="text-[12px] font-semibold text-foreground">目标歌单</Text>
                      <View class="flex-1" />
                      <Button onPress={() => loadLists()} class="items-center justify-center rounded-[6px] border border-line-strong px-2 py-1 active:bg-background">
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
                                class="items-center justify-center rounded-[6px] border border-line-strong px-2 py-1 active:bg-background"
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
                      <Button onPress={() => patch({ auto_sync: !(config().auto_sync ?? false) })} class={`items-center justify-center rounded-[6px] px-2 py-1 ${config().auto_sync ? "bg-primary" : "border border-line-strong"}`}>
                        <Text class={`text-[11px] ${config().auto_sync ? "text-primary-foreground" : "text-foreground"}`}>{config().auto_sync ? "开" : "关"}</Text>
                      </Button>
                    </View>

                    <Text class="text-[12px] font-semibold text-foreground">搜索并加入</Text>
                    <View class="flex-row gap-2">
                      <Input style={inputStyle()}
                        value={kgQuery()}
                        onChange={({ value }) => kgQuery.set(value)}
                        onSubmit={doSearch}
                        placeholder="搜索酷狗歌曲"
                        class="min-w-0 flex-1 rounded-[6px] border border-line-strong px-2 py-1 text-[12px] text-foreground"
                      />
                      <Button onPress={doSearch} class="items-center justify-center rounded-[6px] bg-primary px-3 py-1 active:opacity-80">
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
                              <Button onPress={() => addToPlaylist(item())} class="items-center justify-center rounded-[6px] bg-primary px-2 py-1 active:opacity-80">
                                <Text class="text-[11px] text-primary-foreground">加入歌单</Text>
                              </Button>
                              <Button onPress={() => addKugouToBoard(item())} class="items-center justify-center rounded-[6px] border border-line-strong px-2 py-1 active:bg-background">
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
              <If when={config().active_plugin === "kugou" && !config().kugou_enabled}>
                <Text class="text-[12px] text-faint">酷狗服务已停用，上方开关可重新启用。</Text>
              </If>
            </View>
          </Scroll>
        </View>
      </Dialog>

      <Dialog
        open={aboutOpen()}
        onOpenChange={({ open }: any) => aboutOpen.set(open)}
        class="m-auto w-[400px] rounded-(--radius) border border-line bg-card shadow-2xl"
        backdropClass="bg-overlay"
      >
        <View class="gap-3 p-5">
          <View class="flex-row items-center gap-3">
            <Image src={logo} class="h-10 w-10 rounded-[4px]" />
            <View class="flex-1">
              <Text class="text-[14px] font-semibold text-foreground">SUSUSongBoard</Text>
              <Text class="text-[11px] text-faint">v{APP_VERSION} · NSH 原生版</Text>
            </View>
            <Button testID="about-close" onPress={() => aboutOpen.set(false)} class="items-center justify-center rounded-[6px] border border-line-strong px-3 py-1 active:bg-background">
              <Text class="text-[12px] text-foreground">关闭</Text>
            </Button>
          </View>
          <View class="h-px bg-line" />
          <Text class="text-[12px] text-muted-foreground">抖音直播间点歌看板，原生渲染，无需 WebView2 / Node 侧车。</Text>
          <Text class="text-[11px] text-faint">仓库：{APP_REPO} · 分支 nsh</Text>
          <Text class="text-[11px] text-faint">运行要求：Windows 10 1809+ / macOS 14+</Text>
          <Button testID="about-update" onPress={checkUpdate} class="items-center justify-center self-start rounded-[6px] bg-primary px-3 py-2 active:opacity-80">
            <Text class="text-[12px] text-primary-foreground">{aboutBusy() ? "检查中…" : "检查更新"}</Text>
          </Button>
          <Text class="text-[11px] text-muted-foreground">{aboutMsg()}</Text>
          <Text class="text-[10px] text-faint">更新源尚未配置时，请到 GitHub Releases 手动下载。</Text>
        </View>
      </Dialog>
    </View>
  );
}
mount(Board);
