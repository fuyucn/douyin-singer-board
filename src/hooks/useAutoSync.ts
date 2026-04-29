import { useEffect, useRef } from 'react';
import {
  addTrackToPlaylist,
  searchKuGouPreferredHit,
  searchKuGouTopHit,
  type KuGouTrack,
  type KuGouEntry,
} from '../kugouSession';
import type { DanmuInfo } from '../types';

interface Props {
  autoSync: boolean;
  songs: DanmuInfo[];
  kugouCache: Record<string, KuGouEntry>;
  setKugouCache: React.Dispatch<React.SetStateAction<Record<string, KuGouEntry>>>;
  targetPlaylistId: number;
  kugouLoggedIn: boolean;
  preferCumulative: boolean;
  onSynced: (track: KuGouTrack, song: DanmuInfo) => void;
  pushLog: (line: string) => void;
}

const RETRY_MS = 60_000;

/** Process songs in FIFO order, auto-adding found ones with 3-5s random delay.
 *  Retries not_found searches every 60 seconds. */
export function useAutoSync({
  autoSync,
  songs,
  kugouCache,
  setKugouCache,
  targetPlaylistId,
  kugouLoggedIn,
  preferCumulative,
  onSynced,
  pushLog,
}: Props) {
  const timerRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const songsRef = useRef(songs);
  const cacheRef = useRef(kugouCache);
  const lastRetryRef = useRef<Map<string, number>>(new Map());

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
        const now = Date.now();
        const currentSongs = songsRef.current;
        const currentCache = cacheRef.current;
        const search = preferCumulative ? searchKuGouPreferredHit : searchKuGouTopHit;

        // Retry not_found entries every RETRY_MS
        for (const s of currentSongs) {
          const name = s.song_name.trim();
          if (!name) continue;
          const entry = currentCache[name];
          if (entry?.status !== 'not_found') continue;
          const last = lastRetryRef.current.get(name) ?? 0;
          if (now - last < RETRY_MS) continue;
          lastRetryRef.current.set(name, now);
          setKugouCache((prev) => ({ ...prev, [name]: { status: 'pending' } }));
          search(name)
            .then((track) => {
              setKugouCache((prev) => ({
                ...prev,
                [name]: track ? { status: 'found', track } : { status: 'not_found' },
              }));
            })
            .catch(() => {});
        }

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
  }, [autoSync, kugouLoggedIn, targetPlaylistId, preferCumulative, setKugouCache, onSynced, pushLog]);
}
