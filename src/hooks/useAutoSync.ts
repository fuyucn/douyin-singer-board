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

    const schedule = () => {
      const delay = 3000 + Math.random() * 2000;
      timerRef.current = window.setTimeout(tick, delay);
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

        // Find first 'found' AND non-blocked song (skip blacklisted, leave in queue)
        const found = currentSongs.find((s) => {
          const entry = currentCache[s.song_name.trim()];
          return entry?.status === 'found' && !entry.blockedReason;
        });

        if (found) {
          const entry = currentCache[found.song_name.trim()];
          if (entry?.status === 'found') {
            // Cooldown guard — skip if same song_name was added within cooldown window
            if (checkCooldownRef.current(found.song_name)) {
              if (!lastSkippedRef.current.has(`cooldown:${found.song_name}`)) {
                pushLog(`[auto-sync] cooldown skip: ${found.song_name}`);
                lastSkippedRef.current.add(`cooldown:${found.song_name}`);
              }
              return;
            }
            await addTrackToPlaylist(entry.track, targetPlaylistId);
            lastSkippedRef.current.delete(`cooldown:${found.song_name}`);
            onSynced(entry.track, found);
            pushLog(`[auto-sync] ${found.song_name} → playlist`);
          }
        } else {
          // Log once per blacklisted song to avoid spam
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
        pushLog(`[auto-sync] err: ${e}`);
      } finally {
        processingRef.current = false;
        schedule();
      }
    };

    timerRef.current = window.setTimeout(tick, 2000);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [autoSync, kugouLoggedIn, targetPlaylistId, onSynced, pushLog]);
}
