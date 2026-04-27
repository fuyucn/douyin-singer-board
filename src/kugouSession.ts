// KuGou session lifecycle — login persistence, one-time device registration,
// background token refresh. The dev panel and the eventual production UI both
// drive everything through these helpers; SQLite is the only source of truth.

import { invoke } from '@tauri-apps/api/core';
import {
  loadKugouSession,
  saveKugouSession,
  sessionToCookie,
  type KugouSession,
} from './db';

interface ApiResult {
  status: number;
  body: any;
}

async function call(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<ApiResult> {
  return invoke<ApiResult>('kugou_api_request', { method, path, cookie, body });
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
    throw new Error(
      `refresh failed: status=${resp.status}, body=${JSON.stringify(resp.body)}`,
    );
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
  const create = await call(
    'GET',
    `/playlist/add?name=${encodeURIComponent(trimmed)}`,
    cookie,
  );
  const data = create.body?.data ?? {};
  const info = data.info ?? {};
  const newId =
    info.listid ??
    info.list_create_listid ??
    data.listid ??
    data.list_create_listid ??
    0;
  if (create.body?.status !== 1 || !newId) {
    throw new Error(
      `playlist/add failed: status=${create.status} body=${JSON.stringify(create.body)}`,
    );
  }
  return { listid: Number(newId), created: true };
}

/** Minimal song metadata required by /playlist/tracks/add. */
export interface KuGouTrack {
  filename: string;
  hash: string;
  album_id: string;
  mixsongid: string;
}

/**
 * Authenticated top-1 search via the local kugou-api /search endpoint.
 * Returns null when not logged in or the upstream returned no hits — callers
 * use this to decide whether the row's "add to playlist" button should be
 * enabled.
 */
export async function searchKuGouTopHit(
  keyword: string,
): Promise<KuGouTrack | null> {
  const k = keyword.trim();
  if (!k) return null;
  const cookie = await currentCookie();
  if (!cookie) return null;
  const resp = await call(
    'GET',
    `/search?keywords=${encodeURIComponent(k)}&pagesize=5`,
    cookie,
  );
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

/**
 * Add a track to the given listid via /playlist/tracks/add. The `data` field
 * is the upstream's pipe-delimited shorthand:
 *   name|hash|album_id|mixsongid
 */
export async function addTrackToPlaylist(
  track: KuGouTrack,
  listid: number,
): Promise<void> {
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
    throw new Error(
      `tracks/add failed: status=${resp.status} body=${JSON.stringify(resp.body)}`,
    );
  }
}

export type { KugouSession };
