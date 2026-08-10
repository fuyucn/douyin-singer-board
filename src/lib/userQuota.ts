import type { DanmuInfo } from '../types';

// Per-user session quota for the "max songs per user" limit.
//
// The basis is songs ALREADY added to the playlist (the `played` list) — not
// raw requests. So requests blocked by blacklist/cooldown/not-found never reach
// `played` and don't burn quota. Manual host adds (uid 'manual') are exempt and
// never counted. Single source of truth shared by the auto-sync enforcement
// (App) and the UI badge (MainContent), so the two can never diverge.

export function countAddedByUid(played: DanmuInfo[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of played) {
    if (p.uid === 'manual') continue;
    m.set(p.uid, (m.get(p.uid) ?? 0) + 1);
  }
  return m;
}

// Whether `song` is at/over its requester's limit and should be skipped by
// auto-sync. `limit` of 0 means unlimited; manual adds are never limited.
export function isOverUserLimit(
  song: DanmuInfo,
  addedByUid: Map<string, number>,
  limit: number,
): boolean {
  if (!limit || song.uid === 'manual') return false;
  return (addedByUid.get(song.uid) ?? 0) >= limit;
}
