// Pure state machine for Kugou auto-sync. No NSH imports: unit-testable.
import type { DanmuInfo } from "./types";

export type SyncPhase = "idle" | "in_flight" | "synced" | "failed" | "manual" | "aborted";

export interface SyncRecord {
  phase: SyncPhase;
  attempts: number;
  retryAt: number;
  hash?: string;
  error?: string;
}

export interface TrackLike {
  name: string;
  artist: string;
  hash: string;
  albumId?: string;
  mixSongId?: string;
  duration?: number;
}

export type SearchState =
  | { status: "pending" }
  | { status: "found"; track: TrackLike }
  | { status: "not_found" }
  | { status: "error"; msg: string };

const epoch = () => Date.now() / 1000;

/**
 * One record per requested song (keyed by msg_id). Claiming is the single
 * gateway to a playlist write: both the background worker and a manual
 * "mark played" press go through it, so a song is never added twice.
 */
export class SyncLedger {
  private records = new Map<string, SyncRecord>();
  private clock: () => number;

  constructor(now: () => number = epoch) {
    this.clock = now;
  }

  phase(key: string): SyncPhase {
    return this.records.get(key)?.phase ?? "idle";
  }

  record(key: string): SyncRecord | undefined {
    return this.records.get(key);
  }

  /** True when this song may start a new sync attempt. */
  canAttempt(key: string): boolean {
    const r = this.records.get(key);
    if (!r) return true;
    if (r.phase === "idle" || r.phase === "aborted") return true;
    if (r.phase === "failed") return this.clock() >= r.retryAt;
    return false;
  }

  /** Take ownership of a song. Returns false when another writer owns it. */
  claim(key: string): boolean {
    if (!this.canAttempt(key)) return false;
    const attempts = (this.records.get(key)?.attempts ?? 0) + 1;
    this.records.set(key, { phase: "in_flight", attempts, retryAt: 0 });
    return true;
  }

  synced(key: string, hash: string): void {
    const r = this.records.get(key);
    if (r?.phase === "manual" || r?.phase === "aborted") return;
    this.records.set(key, { phase: "synced", attempts: r?.attempts ?? 1, retryAt: 0, hash });
  }

  failed(key: string, error: string, retryAfterSeconds: number): void {
    const r = this.records.get(key);
    if (r?.phase === "manual" || r?.phase === "aborted") return;
    this.records.set(key, {
      phase: "failed",
      attempts: r?.attempts ?? 1,
      retryAt: this.clock() + retryAfterSeconds,
      error,
    });
  }

  /** A manual press takes over an in-flight worker task: the worker's late
   *  result must not move a row the user already moved. */
  manual(key: string): void {
    const r = this.records.get(key);
    if (r?.phase === "synced") return;
    this.records.set(key, { phase: "manual", attempts: r?.attempts ?? 1, retryAt: 0 });
  }

  /** On config / session / playlist changes, drop in-flight ownership so the
   *  next generation can retry; completed records stay. */
  abortInFlight(): void {
    for (const [key, r] of this.records) {
      if (r.phase === "in_flight") {
        this.records.set(key, { phase: "idle", attempts: r.attempts, retryAt: 0 });
      }
    }
  }

  prune(liveKeys: Set<string>): void {
    for (const key of this.records.keys()) {
      if (!liveKeys.has(key)) this.records.delete(key);
    }
  }
}

export interface PickOptions {
  cache: Record<string, SearchState | undefined>;
  ledger: SyncLedger;
  blocked: (track: TrackLike) => string | null;
  overLimit: (song: DanmuInfo) => boolean;
  coolingDown: (name: string) => boolean;
}

/** First queue song that is searchable, unblocked, and not owned by another
 *  writer. Pure: the caller claims the returned key. */
export function pickNextSync(
  songs: DanmuInfo[],
  opts: PickOptions,
): { song: DanmuInfo; track: TrackLike; key: string } | null {
  for (const song of songs) {
    const key = song.msg_id;
    if (!opts.ledger.canAttempt(key)) continue;
    const name = song.song_name.trim();
    const entry = opts.cache[name];
    if (!entry || entry.status !== "found") continue;
    if (opts.blocked(entry.track)) continue;
    if (opts.overLimit(song) || opts.coolingDown(name)) continue;
    return { song, track: entry.track, key };
  }
  return null;
}

/** 3-5s normally; exponential backoff 5/10/20/40/60s after failures. */
export function nextDelay(failCount: number, rand: () => number = Math.random): number {
  if (failCount <= 0) return 3000 + rand() * 2000;
  return Math.min(5000 * 2 ** (failCount - 1), 60000);
}

/** Upstream auth failures must stop the worker instead of hammering a dead
 *  token every few seconds. */
export function isAuthFailure(res: { status: number; msg?: string }, error?: string): boolean {
  if (res.status === 1) return false;
  const text = `${res.msg ?? ""} ${error ?? ""}`.toLowerCase();
  if (/token|登录|登陆|失效|过期|重新登录|unauthor|forbidden|cookie/.test(text)) return true;
  return /(?:^|\D)(401|403|1001|20001)(?:\D|$)/.test(text);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}秒`;
  if (s < 3600) return `${Math.floor(s / 60)}分${s % 60}秒`;
  return `${Math.floor(s / 3600)}时${Math.floor((s % 3600) / 60)}分`;
}
