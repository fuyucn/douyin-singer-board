import Database from '@tauri-apps/plugin-sql';
import type { Config, DanmuInfo } from './types';

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load('sqlite:sususingerboard.db');
  return _db;
}

export async function loadConfig(): Promise<Config> {
  const db = await getDb();
  const rows = await db.select<Array<Config & { id: number; sing_cd: number }>>(
    'SELECT room_id, sing_prefix, fans_level, sing_cd FROM config WHERE id = 1',
  );
  if (rows.length === 0) {
    // The migration already inserts a row; this is a defensive fallback.
    await db.execute('INSERT OR IGNORE INTO config (id) VALUES (1)');
    return { room_id: '', sing_prefix: '点歌[space][song]', fans_level: 0, sing_cd: 60 };
  }
  return rows[0];
}

export async function saveConfig(cfg: Config): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE config SET room_id = $1, sing_prefix = $2, fans_level = $3, sing_cd = $4 WHERE id = 1`,
    [cfg.room_id, cfg.sing_prefix, cfg.fans_level, cfg.sing_cd ?? 60],
  );
}

export async function insertHistory(d: DanmuInfo, sessionId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR IGNORE INTO history
     (msg_id, uid, uname, song_name, raw_msg, medal_level, medal_name, send_time, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [d.msg_id, d.uid, d.uname, d.song_name, d.raw_msg, d.medal_level, d.medal_name, d.send_time, sessionId],
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
