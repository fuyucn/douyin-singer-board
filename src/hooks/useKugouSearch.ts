import { useEffect, useRef, useState } from 'react';
import { searchKuGouPreferredHit, searchKuGouTopHit, type KuGouEntry } from '../kugouSession';
import type { DanmuInfo } from '../types';

interface Options {
  songs: DanmuInfo[];
  played: DanmuInfo[];
  kugouLoggedIn: boolean;
  preferCumulative: boolean;
}

/**
 * Pre-fetches KuGou search results for every unique song name in songs+played.
 * Caches results by song name; never re-fetches the same name.
 */
export function useKugouSearch({ songs, played, kugouLoggedIn, preferCumulative }: Options) {
  const [cache, setCache] = useState<Record<string, KuGouEntry>>({});
  const startedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!kugouLoggedIn) return;
    const search = preferCumulative ? searchKuGouPreferredHit : searchKuGouTopHit;

    for (const s of [...songs, ...played]) {
      const name = s.song_name.trim();
      if (!name || startedRef.current.has(name)) continue;
      startedRef.current.add(name);
      setCache((prev) => ({ ...prev, [name]: { status: 'pending' } }));

      search(name)
        .then((track) => {
          setCache((prev) => ({
            ...prev,
            [name]: track ? { status: 'found', track } : { status: 'not_found' },
          }));
        })
        .catch((err) => {
          setCache((prev) => ({ ...prev, [name]: { status: 'error', msg: String(err) } }));
        });
    }
  }, [songs, played, kugouLoggedIn, preferCumulative]);

  return cache;
}
