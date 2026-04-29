import { useEffect, useRef } from 'react';
import { addTrackToPlaylist, type KuGouTrack, type KuGouEntry } from '../kugouSession';
import type { DanmuInfo } from '../types';

interface Props {
  autoSync: boolean;
  songs: DanmuInfo[];
  kugouCache: Record<string, KuGouEntry>;
  targetPlaylistId: number;
  kugouLoggedIn: boolean;
  onSynced: (track: KuGouTrack, song: DanmuInfo) => void;
  pushLog: (line: string) => void;
}

/** Process songs in display order, auto-adding found ones with 3-5s random delay.
 *  Only songs already found by the eager search are eligible; never retries. */
export function useAutoSync({
  autoSync,
  songs,
  kugouCache,
  targetPlaylistId,
  kugouLoggedIn,
  onSynced,
  pushLog,
}: Props) {
  const timerRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const songsRef = useRef(songs);
  const cacheRef = useRef(kugouCache);

  songsRef.current = songs;
  cacheRef.current = kugouCache;

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
      if (processingRef.current) { schedule(); return; }
      processingRef.current = true;
      try {
        const currentSongs = songsRef.current;
        const currentCache = cacheRef.current;

        // Find first 'found' song in display order (top → bottom)
        const found = currentSongs.find((s) => {
          const entry = currentCache[s.song_name.trim()];
          return entry?.status === 'found';
        });

        if (found) {
          const entry = currentCache[found.song_name.trim()];
          if (entry?.status === 'found') {
            await addTrackToPlaylist(entry.track, targetPlaylistId);
            onSynced(entry.track, found);
            pushLog(`[auto-sync] ${found.song_name} → playlist`);
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
