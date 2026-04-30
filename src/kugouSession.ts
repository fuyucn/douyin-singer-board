// KuGou session lifecycle — login persistence, one-time device registration,
// background token refresh. The dev panel and the eventual production UI both
// drive everything through these helpers; SQLite is the only source of truth.

import { invoke } from '@tauri-apps/api/core';
import { loadKugouSession, saveKugouSession, sessionToCookie, type KugouSession } from './db';

interface ApiResult {
  status: number;
  body: any;
}

export async function call(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<ApiResult> {
  const sep = path.includes('?') ? '&' : '?';
  const pathWithTs = `${path}${sep}_t=${Date.now()}`;
  return invoke<ApiResult>('kugou_api_request', { method, path: pathWithTs, cookie, body });
}

/** Persist (token, userid) coming out of a successful QR check. */
export async function saveLogin(token: string, userid: string): Promise<void> {
  await saveKugouSession({
    token,
    userid,
    refreshed_at: Math.floor(Date.now() / 1000),
  });
}

/**
 * Call /register/dev to obtain dfid — but only when we don't already have one.
 * KuGou's device registry is a one-shot per (server-startup, account); we
 * persist dfid so subsequent app launches reuse it.
 *
 * Returns the dfid in use, or '' if registration failed.
 */
export async function ensureDeviceRegistered(): Promise<string> {
  const sess = await loadKugouSession();
  if (sess.dfid) return sess.dfid;

  const cookie = sessionToCookie(sess);
  const resp = await call('GET', '/register/dev', cookie);
  const dfid = String(resp.body?.data?.dfid ?? '');
  if (dfid) {
    await saveKugouSession({ dfid });
  }
  return dfid;
}

/**
 * Force a token refresh via /login/token. KuGou rotates the token on call;
 * we update the stored row + bump refreshed_at.
 *
 * Returns the new token, or throws if the upstream rejected.
 */
export async function refreshToken(): Promise<string> {
  const sess = await loadKugouSession();
  if (!sess.token || !sess.userid) {
    throw new Error('not logged in — no token to refresh');
  }

  const cookie = sessionToCookie(sess);
  const resp = await call('GET', '/login/token', cookie);
  const newToken = String(resp.body?.data?.token ?? resp.body?.token ?? '');
  if (resp.body?.status !== 1 || !newToken) {
    throw new Error(`refresh failed: status=${resp.status}, body=${JSON.stringify(resp.body)}`);
  }
  await saveKugouSession({
    token: newToken,
    refreshed_at: Math.floor(Date.now() / 1000),
  });
  return newToken;
}

/**
 * Refresh the stored token if it's older than `staleSeconds` (default 24h).
 * Designed to be called on app startup; failures are swallowed (the next
 * authenticated call will surface auth errors and retrigger login UI).
 */
export async function refreshTokenIfStale(
  staleSeconds = 24 * 3600,
): Promise<{ refreshed: boolean; reason?: string }> {
  try {
    const sess = await loadKugouSession();
    if (!sess.token || !sess.userid) {
      return { refreshed: false, reason: 'not logged in' };
    }
    const age = Math.floor(Date.now() / 1000) - sess.refreshed_at;
    if (age < staleSeconds) {
      return { refreshed: false, reason: `fresh (${age}s old)` };
    }
    await refreshToken();
    return { refreshed: true };
  } catch (e) {
    return { refreshed: false, reason: String(e) };
  }
}

/** Convenience: load session as the cookie string ready for kugou_api_request. */
export async function currentCookie(): Promise<string> {
  const sess = await loadKugouSession();
  return sessionToCookie(sess);
}

/**
 * Look up `name` in the user's playlists; if missing, create a fresh one.
 * Returns the listid the caller should use as the auto-add destination.
 */
export async function resolvePlaylistByName(
  name: string,
): Promise<{ listid: number; created: boolean }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('playlist name is empty');
  const cookie = await currentCookie();
  if (!cookie) throw new Error('not logged in (no cookie)');

  // 1) check existing
  const list = await call('GET', '/user/playlist?pagesize=100', cookie);
  const arr: Array<{ name: string; listid: number }> = list.body?.data?.info ?? [];
  const found = arr.find((p) => (p.name || '').trim() === trimmed);
  if (found && found.listid) return { listid: found.listid, created: false };

  // 2) create — KuGou's response nests the new playlist under data.info
  // (data.info.listid), not directly under data, so we probe both shapes.
  const create = await call('GET', `/playlist/add?name=${encodeURIComponent(trimmed)}`, cookie);
  const data = create.body?.data ?? {};
  const info = data.info ?? {};
  const newId =
    info.listid ?? info.list_create_listid ?? data.listid ?? data.list_create_listid ?? 0;
  if (create.body?.status !== 1 || !newId) {
    throw new Error(
      `playlist/add failed: status=${create.status} body=${JSON.stringify(create.body)}`,
    );
  }
  return { listid: Number(newId), created: true };
}

/**
 * Minimal song metadata required by /playlist/tracks/add. `plays` is our
 * own annotation from /user/listen and only meaningful for variants that
 * appear in the streamer's top-120 cumulative history (0 otherwise).
 */
export interface KuGouTrack {
  filename: string;
  hash: string;
  album_id: string;
  mixsongid: string;
  plays?: number;
}

/** Per-song KuGou search state used by both the UI and auto-sync hook. */
export type KuGouEntry =
  | { status: 'pending' }
  | { status: 'found'; track: KuGouTrack }
  | { status: 'not_found' }
  | { status: 'error'; msg: string };

/**
 * Authenticated top-1 search — kept as a fallback. Production callers should
 * prefer `searchKuGouPreferredHit` so we tilt toward versions the streamer
 * has actually played (KuGou returns many variants per title).
 */
export async function searchKuGouTopHit(keyword: string): Promise<KuGouTrack | null> {
  const k = keyword.trim();
  if (!k) return null;
  const cookie = await currentCookie();
  if (!cookie) return null;
  const resp = await call('GET', `/search?keywords=${encodeURIComponent(k)}&pagesize=5`, cookie);
  const top = resp.body?.data?.lists?.[0];
  if (!top) return null;
  const hash = String(top.FileHash ?? '').toUpperCase();
  if (!hash) return null;
  return {
    filename: String(top.FileName ?? ''),
    hash,
    album_id: String(top.AlbumID ?? ''),
    mixsongid: String(top.MixSongID ?? ''),
  };
}

// In-memory cache of /user/listen?type=1 (cumulative top-120) — refreshed
// every hour. Key = uppercase hash, value = play count. Used by
// `searchKuGouPreferredHit` to bias version selection toward what the
// streamer has actually played.
let listenHistoryCache: { map: Map<string, number>; fetched_at: number } | null = null;
const LISTEN_TTL_SECONDS = 60 * 60;

function extractListenEntries(body: any): Array<{ hash: string; count: number }> {
  // /user/listen?type=1 nests the array at data.lists with `hash` (upper)
  // and `listen_count`. We probe a few alternates for forward compat in
  // case KuGou ever shuffles the gateway shape.
  const arr: any[] = []
    .concat(Array.isArray(body?.data?.lists) ? body.data.lists : [])
    .concat(Array.isArray(body?.data?.songs) ? body.data.songs : [])
    .concat(Array.isArray(body?.data?.list) ? body.data.list : [])
    .concat(Array.isArray(body?.data?.info) ? body.data.info : [])
    .concat(Array.isArray(body?.data) ? body.data : []);
  return arr
    .filter((x: any) => x && (x.hash || x.FileHash))
    .map((x: any) => ({
      hash: String(x.hash ?? x.FileHash ?? '').toUpperCase(),
      count: Number(x.listen_count ?? x.play_count ?? x.playcount ?? x.pc ?? x.count ?? 1),
    }));
}

export async function listenHistoryMap(force = false): Promise<Map<string, number>> {
  const now = Math.floor(Date.now() / 1000);
  if (!force && listenHistoryCache && now - listenHistoryCache.fetched_at < LISTEN_TTL_SECONDS) {
    return listenHistoryCache.map;
  }
  const cookie = await currentCookie();
  if (!cookie) return new Map();
  try {
    const resp = await call('GET', '/user/listen?type=1', cookie);
    const entries = extractListenEntries(resp.body);
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.hash) map.set(e.hash, Math.max(e.count, map.get(e.hash) ?? 0));
    }
    listenHistoryCache = { map, fetched_at: now };
    return map;
  } catch {
    return listenHistoryCache?.map ?? new Map();
  }
}

export function clearListenHistoryCache(): void {
  listenHistoryCache = null;
}

/**
 * Cross-references search results with the streamer's listen history and
 * returns the variant they've played the most. Falls back to the first hit
 * when no match. Examines both top-level lists and their Grp[] variants
 * (KuGou groups remasters / live / different albums of the same song).
 */
export async function searchKuGouPreferredHit(keyword: string): Promise<KuGouTrack | null> {
  const k = keyword.trim();
  if (!k) return null;
  const cookie = await currentCookie();
  if (!cookie) return null;

  const resp = await call('GET', `/search?keywords=${encodeURIComponent(k)}&pagesize=10`, cookie);
  const lists = resp.body?.data?.lists ?? [];
  if (!Array.isArray(lists) || lists.length === 0) return null;

  type Candidate = KuGouTrack & {
    plays: number; // primary: streamer's own play count from /user/listen
    ownerCount: number; // secondary: KuGou-wide collectors of this version
  };
  const candidates: Candidate[] = [];
  const playMap = await listenHistoryMap();

  const visit = (item: any) => {
    const hash = String(item?.FileHash ?? '').toUpperCase();
    if (!hash) return;
    candidates.push({
      filename: String(item.FileName ?? ''),
      hash,
      album_id: String(item.AlbumID ?? ''),
      mixsongid: String(item.MixSongID ?? ''),
      plays: playMap.get(hash) ?? 0,
      ownerCount: Number(item.OwnerCount ?? 0),
    });
    if (Array.isArray(item.Grp)) {
      for (const g of item.Grp) visit(g);
    }
  };
  for (const item of lists) visit(item);

  if (candidates.length === 0) return null;

  // Two-stage rank:
  //   1. play count from listen history (>0 means streamer has played this
  //      exact version) — strongest signal we have for "preferred version"
  //   2. OwnerCount (KuGou-wide collectors) — when nothing matches the
  //      top-120 history, the canonical version usually has orders of
  //      magnitude more collectors than reissues/live cuts/karaoke
  // We never break ties on search order alone; OwnerCount handles it.
  candidates.sort((a, b) => {
    if (a.plays !== b.plays) return b.plays - a.plays;
    return b.ownerCount - a.ownerCount;
  });
  const best = candidates[0];
  return {
    filename: best.filename,
    hash: best.hash,
    album_id: best.album_id,
    mixsongid: best.mixsongid,
  };
}

/**
 * Add a track to the given listid via /playlist/tracks/add. The `data` field
 * is the upstream's pipe-delimited shorthand:
 *   name|hash|album_id|mixsongid
 */
export async function addTrackToPlaylist(track: KuGouTrack, listid: number): Promise<void> {
  if (!listid) throw new Error('no target playlist set');
  const cookie = await currentCookie();
  if (!cookie) throw new Error('not logged in');
  const data = `${track.filename}|${track.hash}|${track.album_id}|${track.mixsongid}`;
  const resp = await call(
    'GET',
    `/playlist/tracks/add?listid=${listid}&data=${encodeURIComponent(data)}`,
    cookie,
  );
  if (resp.body?.status !== 1) {
    throw new Error(`tracks/add failed: status=${resp.status} body=${JSON.stringify(resp.body)}`);
  }
}

export type { KugouSession };
