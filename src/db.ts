import Database from '@tauri-apps/plugin-sql';
import type { Config, DanmuInfo } from './types';

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load('sqlite:sususongboard.db');

  // Migrate/create blacklist table (frontend-managed, not in Tauri migrations).
  // Use try/catch probing — db.execute() may throw for non-schema reasons on
  // SELECT, so all CREATE paths are guarded with IF NOT EXISTS for idempotency.
  try {
    await _db.execute("SELECT entry_type FROM blacklist LIMIT 0");
  } catch {
    try {
      await _db.execute("SELECT song_name FROM blacklist LIMIT 0");
      // Old schema found → migrate
      await _db.execute(
        `CREATE TABLE IF NOT EXISTS blacklist_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_type TEXT NOT NULL CHECK (entry_type IN ('song', 'singer')),
          song_name TEXT NOT NULL DEFAULT '',
          singer_name TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )`,
      );
      // Only copy if blacklist_new was just created (empty), otherwise a prior
      // partial migration left it behind and we need to start fresh.
      const count = await _db.select<{ cnt: number }[]>(
        'SELECT COUNT(*) as cnt FROM blacklist_new',
      );
      if (count[0].cnt === 0) {
        await _db.execute(
          "INSERT INTO blacklist_new (id, entry_type, song_name, singer_name, created_at) SELECT id, 'song', song_name, '', created_at FROM blacklist",
        );
      }
      await _db.execute('DROP TABLE IF EXISTS blacklist');
      await _db.execute('ALTER TABLE blacklist_new RENAME TO blacklist');
      await _db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_bl_song_unique ON blacklist(song_name, singer_name) WHERE entry_type = 'song'",
      );
      await _db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_bl_singer_unique ON blacklist(singer_name) WHERE entry_type = 'singer'",
      );
    } catch {
      // Neither probe succeeded — create fresh (safe against prior partial state)
      await _db.execute(
        `CREATE TABLE IF NOT EXISTS blacklist (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_type TEXT NOT NULL CHECK (entry_type IN ('song', 'singer')),
          song_name TEXT NOT NULL DEFAULT '',
          singer_name TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )`,
      );
      await _db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_bl_song_unique ON blacklist(song_name, singer_name) WHERE entry_type = 'song'",
      );
      await _db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_bl_singer_unique ON blacklist(singer_name) WHERE entry_type = 'singer'",
      );
    }
  }

  return _db;
}

export async function loadConfig(): Promise<Config> {
  const db = await getDb();
  const rows = await db.select<Config[]>(
    `SELECT room_id, sing_prefix, fans_level, sing_cd,
            target_playlist_name, target_playlist_id
     FROM config WHERE id = 1`,
  );
  if (rows.length === 0) {
    // The migration already inserts a row; this is a defensive fallback.
    await db.execute('INSERT OR IGNORE INTO config (id) VALUES (1)');
    return {
      room_id: '',
      sing_prefix: '点歌[space][song]',
      fans_level: 0,
      sing_cd: 60,
      target_playlist_name: '',
      target_playlist_id: 0,
    };
  }
  return rows[0];
}

export async function saveConfig(cfg: Config): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE config SET room_id = $1, sing_prefix = $2, fans_level = $3, sing_cd = $4,
                       target_playlist_name = $5, target_playlist_id = $6
     WHERE id = 1`,
    [
      cfg.room_id,
      cfg.sing_prefix,
      cfg.fans_level,
      cfg.sing_cd ?? 60,
      cfg.target_playlist_name ?? '',
      cfg.target_playlist_id ?? 0,
    ],
  );
}

export async function insertHistory(d: DanmuInfo, sessionId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR IGNORE INTO history
     (msg_id, uid, uname, song_name, raw_msg, medal_level, medal_name, send_time, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      d.msg_id,
      d.uid,
      d.uname,
      d.song_name,
      d.raw_msg,
      d.medal_level,
      d.medal_name,
      d.send_time,
      sessionId,
    ],
  );
}

export async function loadSessionHistory(sessionId: string): Promise<DanmuInfo[]> {
  const db = await getDb();
  return db.select<DanmuInfo[]>(
    `SELECT msg_id, uid, uname, song_name, raw_msg, medal_level, medal_name, send_time
     FROM history WHERE session_id = $1 ORDER BY send_time ASC`,
    [sessionId],
  );
}

export async function deleteHistoryByMsgId(msgId: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM history WHERE msg_id = $1', [msgId]);
}

export async function clearSessionHistory(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM history WHERE session_id = $1', [sessionId]);
}

// KuGou login session — single-row table keyed at id=1, persists across app
// restarts so we don't re-register the device or re-scan QR every launch.
export interface KugouSession {
  token: string;
  userid: string;
  dfid: string;
  refreshed_at: number; // unix seconds
}

export async function loadKugouSession(): Promise<KugouSession> {
  const db = await getDb();
  const rows = await db.select<KugouSession[]>(
    'SELECT token, userid, dfid, refreshed_at FROM kugou_session WHERE id = 1',
  );
  if (rows.length === 0) {
    await db.execute('INSERT OR IGNORE INTO kugou_session (id) VALUES (1)');
    return { token: '', userid: '', dfid: '', refreshed_at: 0 };
  }
  return rows[0];
}

export async function saveKugouSession(s: Partial<KugouSession>): Promise<void> {
  const db = await getDb();
  // Patch only the provided fields so callers can update token+refreshed_at
  // without clobbering dfid (etc).
  const fields: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  for (const k of ['token', 'userid', 'dfid', 'refreshed_at'] as const) {
    if (s[k] !== undefined) {
      fields.push(`${k} = $${i++}`);
      args.push(s[k]);
    }
  }
  if (fields.length === 0) return;
  await db.execute(`UPDATE kugou_session SET ${fields.join(', ')} WHERE id = 1`, args);
}

export async function clearKugouSession(): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE kugou_session SET token = '', userid = '', dfid = '', refreshed_at = 0 WHERE id = 1`,
  );
}

/** Build the cookie string for kugou_api_request from a session row. */
export function sessionToCookie(s: KugouSession): string {
  const parts: string[] = [];
  if (s.token) parts.push(`token=${s.token}`);
  if (s.userid) parts.push(`userid=${s.userid}`);
  if (s.dfid) parts.push(`dfid=${s.dfid}`);
  return parts.join(';');
}

// ─── Blacklist ────────────────────────────────────────────────────────────────

export interface BlacklistEntry {
  id: number;
  entry_type: 'song' | 'singer';
  song_name: string;
  singer_name: string;
  created_at: number;
}

export async function loadBlacklist(): Promise<BlacklistEntry[]> {
  const db = await getDb();
  const rows = await db.select<BlacklistEntry[]>(
    'SELECT id, entry_type, song_name, singer_name, created_at FROM blacklist ORDER BY created_at DESC',
  );
  return rows;
}

export async function addSongToBlacklist(songName: string, singerName: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO blacklist (entry_type, song_name, singer_name) VALUES ('song', $1, $2)",
    [songName, singerName],
  );
}

export async function addSingerToBlacklist(singerName: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO blacklist (entry_type, song_name, singer_name) VALUES ('singer', '', $1)",
    [singerName],
  );
}

export async function removeFromBlacklist(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM blacklist WHERE id = $1', [id]);
}
