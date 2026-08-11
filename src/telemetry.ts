// Opt-in anonymous telemetry. Stored locally in SQLite — there's no remote
// endpoint. Users export events via the About modal and share manually with
// the developer to help diagnose issues.
//
// Events are gated by `opt_in` in `telemetry_config`. Default is OFF; the user
// must explicitly enable in the About modal.
//
// Identity: a one-time random `device_id` (8-byte hex) is generated on first
// opt-in and persisted. It anonymizes the user but lets us correlate events
// from the same install.

import { getDb } from './db';

const RETENTION_DAYS = 30;

let optInCache: boolean | null = null;
let deviceIdCache: string | null = null;

function randomDeviceId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadConfigRow(): Promise<{ opt_in: number; device_id: string }> {
  const db = await getDb();
  const rows = await db.select<Array<{ opt_in: number; device_id: string }>>(
    'SELECT opt_in, device_id FROM telemetry_config WHERE id = 1',
  );
  return rows[0] ?? { opt_in: 0, device_id: '' };
}

export async function isTelemetryOptedIn(): Promise<boolean> {
  if (optInCache !== null) return optInCache;
  const row = await loadConfigRow();
  optInCache = row.opt_in === 1;
  return optInCache;
}

export async function setTelemetryOptIn(optIn: boolean): Promise<void> {
  const db = await getDb();
  // If enabling and no device_id yet, generate one.
  if (optIn) {
    const row = await loadConfigRow();
    const deviceId = row.device_id || randomDeviceId();
    await db.execute('UPDATE telemetry_config SET opt_in = 1, device_id = $1 WHERE id = 1', [
      deviceId,
    ]);
    deviceIdCache = deviceId;
  } else {
    await db.execute('UPDATE telemetry_config SET opt_in = 0 WHERE id = 1');
  }
  optInCache = optIn;
}

export async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  const row = await loadConfigRow();
  deviceIdCache = row.device_id;
  return deviceIdCache;
}

export async function track(event: string, props?: Record<string, unknown>): Promise<void> {
  try {
    if (!(await isTelemetryOptedIn())) return;
    const db = await getDb();
    await db.execute('INSERT INTO telemetry_events (ts, event, props_json) VALUES ($1, $2, $3)', [
      Math.floor(Date.now() / 1000),
      event,
      JSON.stringify(props ?? {}),
    ]);
  } catch {
    // Telemetry must never break the app.
  }
}

/** Auto-prune events older than RETENTION_DAYS. Called periodically. */
export async function pruneOldEvents(): Promise<void> {
  try {
    const db = await getDb();
    const cutoff = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 24 * 3600;
    await db.execute('DELETE FROM telemetry_events WHERE ts < $1', [cutoff]);
  } catch {
    /* ignore */
  }
}

/**
 * Export all events as JSONL string with header line including device_id + version.
 * `logs` are the current in-app log panel lines (timestamped) and are included
 * as `type: "log"` records so diagnostics carry the full recent history.
 */
export async function exportTelemetry(version: string, logs: string[] = []): Promise<string> {
  const db = await getDb();
  const rows = await db.select<Array<{ ts: number; event: string; props_json: string }>>(
    'SELECT ts, event, props_json FROM telemetry_events ORDER BY ts ASC',
  );
  const deviceId = await getDeviceId();
  const header = JSON.stringify({
    type: 'header',
    device_id: deviceId,
    version,
    exported_at: Math.floor(Date.now() / 1000),
    count: rows.length,
    log_count: logs.length,
  });
  const lines = rows.map((r) =>
    JSON.stringify({ ts: r.ts, event: r.event, props: JSON.parse(r.props_json) }),
  );
  const logLines = logs.map((line) => JSON.stringify({ type: 'log', line }));
  return [header, ...lines, ...logLines].join('\n');
}

export async function clearTelemetry(): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM telemetry_events');
}
