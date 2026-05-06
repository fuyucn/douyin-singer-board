import { useEffect, useRef } from 'react';
import { addTrackToPlaylist, type KuGouTrack, type EnrichedEntry } from '../kugouSession';
import type { DanmuInfo } from '../types';

interface Props {
  autoSync: boolean;
  songs: DanmuInfo[];
  kugouCache: Record<string, EnrichedEntry>;
  targetPlaylistId: number;
  kugouLoggedIn: boolean;
  onSynced: (track: KuGouTrack, song: DanmuInfo) => void;
  pushLog: (line: string) => void;
  checkCooldown: (songName: string) => boolean;
}

/** Process songs in display order, auto-adding found ones with 3-5s random delay.
 *  Only songs already found by the eager search are eligible; never retries.
 *  Blacklisted entries are skipped (left in queue with red text) — the loop
 *  finds the first non-blocked 'found' song instead. */
export function useAutoSync({
  autoSync,
  songs,
  kugouCache,
  targetPlaylistId,
  kugouLoggedIn,
  onSynced,
  pushLog,
  checkCooldown,
}: Props) {
  const timerRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const songsRef = useRef(songs);
  const cacheRef = useRef(kugouCache);
  const lastSkippedRef = useRef<Set<string>>(new Set());
  const checkCooldownRef = useRef(checkCooldown);
  const failCountRef = useRef(0);

  songsRef.current = songs;
  cacheRef.current = kugouCache;
  checkCooldownRef.current = checkCooldown;

  useEffect(() => {
    if (!autoSync || !kugouLoggedIn || !targetPlaylistId) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const schedule = (backoff = false) => {
      // Exponential backoff on consecutive failures: 5s, 10s, 20s, 40s, capped at 60s
      const baseDelay = backoff
        ? Math.min(5000 * 2 ** (failCountRef.current - 1), 60000)
        : 3000 + Math.random() * 2000;
      timerRef.current = window.setTimeout(tick, baseDelay);
    };

    const tick = async () => {
      if (processingRef.current) {
        schedule();
        return;
      }
      processingRef.current = true;
      try {
        const currentSongs = songsRef.current;
        const currentCache = cacheRef.current;

        // Find first 'found', non-blocked, non-cooldown song
        let found: DanmuInfo | undefined;
        for (const s of currentSongs) {
          const entry = currentCache[s.song_name.trim()];
          if (!entry || entry.status !== 'found' || entry.blockedReason) continue;
          if (checkCooldownRef.current(s.song_name)) {
            if (!lastSkippedRef.current.has(`cooldown:${s.song_name}`)) {
              pushLog(`[auto-sync] cooldown skip: ${s.song_name}`);
              lastSkippedRef.current.add(`cooldown:${s.song_name}`);
            }
            continue; // skip, try next song
          }
          found = s;
          break;
        }

        if (found) {
          const entry = currentCache[found.song_name.trim()];
          if (entry?.status === 'found') {
            await addTrackToPlaylist(entry.track, targetPlaylistId);
            failCountRef.current = 0; // reset backoff on success
            lastSkippedRef.current.delete(`cooldown:${found.song_name}`);
            onSynced(entry.track, found);
            pushLog(`[auto-sync] ${found.song_name} → playlist`);
          }
        } else {
          // Log once per blocked/cooldown song to avoid spam
          for (const s of currentSongs) {
            const entry = currentCache[s.song_name.trim()];
            if (entry?.status === 'found' && entry.blockedReason) {
              if (!lastSkippedRef.current.has(s.song_name)) {
                pushLog(`[auto-sync] skip blocked (${entry.blockedReason}): ${s.song_name}`);
                lastSkippedRef.current.add(s.song_name);
              }
            }
          }
        }
      } catch (e) {
        failCountRef.current += 1;
        const delay = Math.min(5000 * 2 ** (failCountRef.current - 1), 60000);
        pushLog(`[auto-sync] err (retry in ${delay / 1000}s): ${e}`);
      } finally {
        processingRef.current = false;
        schedule(failCountRef.current > 0);
      }
    };

    timerRef.current = window.setTimeout(tick, 2000);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [autoSync, kugouLoggedIn, targetPlaylistId, onSynced, pushLog]);
}
