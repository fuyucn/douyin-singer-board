// One-shot legacy data bridge for the NSH app.
//
// 0.7.9 uses the same app id as the old Tauri app (`com.sususongboard.app`),
// so `process.dataDir` is the directory that already contains
// `sususongboard.db`. NSH's `fs/promises` module can read that file with the
// `fs.read` capability. We parse the SQLite file in TypeScript (read-only) and
// copy the config / session / blacklist into NSH Storage once.
//
// This is a migration bridge, not a general SQL engine: it reads the three
// tables the old app used and never writes to the old database.
import { dirname, join } from "path";
import { parseSqlite, rowsAsObjects, type SqliteDb } from "./legacy/sqliteReader";

export type LegacySource = "nsh-storage" | "tauri-sqlite";
export interface LegacyMigration {
  source: LegacySource;
  storage: Record<string, string>;
}

type ReadBinaryFile = (path: string) => Promise<Uint8Array>;
type GetItem = (key: string) => Promise<string | null>;

const OLD_NSH_APP_ID = "com.sususongboard.nsh";
const OLD_TAURI_APP_ID = "com.fuyucn.sususongboard";
const DEFAULT_SING_PREFIX = "点歌[space][song]";

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return decodeUtf8(value);
  return String(value);
}

function number(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

function withMarker(storage: Record<string, string>, source: LegacySource): Record<string, string> {
  return {
    ...storage,
    legacyMigrationDone: `${source}@${stamp()}`,
    legacyMigrationSource: source,
  };
}

/** Convert the three old Tauri tables into NSH Storage keys. */
export function convertTauriDatabase(db: SqliteDb): Record<string, string> | null {
  const cfgRows = rowsAsObjects(db, "config");
  if (!cfgRows.length) return null;
  const cfg = cfgRows[0];

  const songs: string[] = [];
  const singers: string[] = [];
  const meta: Record<string, number> = {};
  for (const r of rowsAsObjects(db, "blacklist")) {
    const ts = number(r.created_at, Math.floor(Date.now() / 1000));
    const type = text(r.entry_type);
    const song = text(r.song_name);
    const singer = text(r.singer_name);
    if (type === "song" && song) {
      if (!songs.includes(song)) songs.push(song);
      meta["song:" + song] = ts;
    } else if (type === "singer" && singer) {
      if (!singers.includes(singer)) singers.push(singer);
      meta["singer:" + singer] = ts;
    }
  }

  const kugouEnabled = cfg.kugou_enabled === undefined ? true : number(cfg.kugou_enabled, 0) !== 0;
  const nsCfg = {
    room_id: text(cfg.room_id),
    sing_prefix: text(cfg.sing_prefix) || DEFAULT_SING_PREFIX,
    fans_level: number(cfg.fans_level, 0),
    sing_cd: number(cfg.sing_cd, 0),
    cooldown_seconds: number(cfg.cooldown_seconds, 1800),
    max_songs_per_user: number(cfg.max_songs_per_user, 3),
    target_playlist_name: text(cfg.target_playlist_name),
    target_playlist_id: number(cfg.target_playlist_id, 0),
    kugou_enabled: kugouEnabled,
    blacklist: songs,
    blacklist_singers: singers,
    blacklist_meta: meta,
    auto_sync: false,
    active_plugin: kugouEnabled ? "kugou" : "",
    config_version: 2,
  };

  const storage: Record<string, string> = {
    "board.config": JSON.stringify(nsCfg),
    "board.theme": "system",
  };
  const sessRows = rowsAsObjects(db, "kugou_session");
  const sess = sessRows[0];
  if (sess && text(sess.token) && text(sess.userid)) {
    storage["kugou.session"] = JSON.stringify({
      token: text(sess.token),
      userid: text(sess.userid),
      dfid: text(sess.dfid) || "-",
      nickname: text(sess.userid),
    });
  }
  return storage;
}

async function readOptional(
  readFile: ReadBinaryFile,
  path: string,
): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    // ENOENT, ERR_ACCESS_DENIED, ERR_FEATURE_UNAVAILABLE_ON_PLATFORM and a
    // damaged file all mean "no usable legacy data at this path".
    return null;
  }
}

/**
 * Find legacy data only when the current NSH Storage has no config and no
 * migration marker. The user's explicit goal is to reuse the old Tauri data,
 * so `sususongboard.db` wins whenever it exists; an old NSH storage.json is
 * kept as `legacy.nshStorageBackup` in that case, and used as the source only
 * when no Tauri database is found.
 */
export async function loadLegacyStorage(options: {
  readFile: ReadBinaryFile;
  dataDir: string | null;
  getItem: GetItem;
}): Promise<LegacyMigration | null> {
  const { readFile, dataDir, getItem } = options;
  if (!dataDir) return null;

  try {
    if (await getItem("board.config")) return null;
    if (await getItem("legacyMigrationDone")) return null;
  } catch {
    return null;
  }

  const parent = dirname(dataDir);
  const oldNshPath = join(parent, OLD_NSH_APP_ID, "storage.json");
  let oldNsh: Record<string, string> | null = null;
  const oldNshBytes = await readOptional(readFile, oldNshPath);
  if (oldNshBytes) {
    try {
      const parsed = JSON.parse(decodeUtf8(oldNshBytes)) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && typeof parsed["board.config"] === "string") {
        oldNsh = parsed as Record<string, string>;
      }
    } catch {}
  }

  const dbPaths = [
    join(dataDir, "sususongboard.db"),
    join(parent, OLD_TAURI_APP_ID, "sususongboard.db"),
  ];
  for (const dbPath of dbPaths) {
    const bytes = await readOptional(readFile, dbPath);
    if (!bytes || bytes.length < 16) continue;
    try {
      const magic = new TextDecoder("latin1").decode(bytes.slice(0, 16));
      if (magic !== "SQLite format 3\0") continue;
      const converted = convertTauriDatabase(parseSqlite(bytes));
      if (converted) {
        if (oldNsh) {
          converted["legacy.nshStorageBackup"] = JSON.stringify(oldNsh);
        }
        return { source: "tauri-sqlite", storage: withMarker(converted, "tauri-sqlite") };
      }
    } catch {}
  }

  if (oldNsh) {
    return { source: "nsh-storage", storage: withMarker(oldNsh, "nsh-storage") };
  }
  return null;
}
