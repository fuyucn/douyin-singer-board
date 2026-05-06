import { useEffect, useRef, useState } from 'react';
import { loadKugouSession } from '../db';
import { listenHistoryMap, refreshTokenIfStale, clearListenHistoryCache } from '../kugouSession';
import { useAppStore } from '../store';

interface Options {
  /** Re-check session whenever any of these toggle (e.g. login/debug modal closes) */
  watchTokens: unknown[];
}

/**
 * Manages KuGou login state, listen-history cache, and side effects:
 * - Loads session from DB on mount and whenever watchTokens change
 * - Refreshes stale tokens on startup
 * - Pre-fetches listen history map after login
 * - Auto-disables auto-sync on logout
 */
export function useKugouAuth({ watchTokens }: Options) {
  const [kugouLoggedIn, setKugouLoggedIn] = useState(false);
  const setAutoSync = useAppStore((s) => s.setAutoSync);
  const pushLog = useAppStore((s) => s.pushLog);

  // Load session from DB
  useEffect(() => {
    loadKugouSession()
      .then((s) => setKugouLoggedIn(Boolean(s.token && s.userid && s.dfid)))
      .catch(() => setKugouLoggedIn(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, watchTokens);

  // Auto-disable auto-sync on logout (login → false transition only)
  const prevLoggedIn = useRef(kugouLoggedIn);
  useEffect(() => {
    if (!kugouLoggedIn && prevLoggedIn.current) {
      setAutoSync(false);
      clearListenHistoryCache();
    }
    prevLoggedIn.current = kugouLoggedIn;
  }, [kugouLoggedIn, setAutoSync]);

  // Cache listen history after login
  useEffect(() => {
    if (!kugouLoggedIn) return;
    listenHistoryMap()
      .then((m) => pushLog(`[kugou] listen history cached: ${m.size} hashes`))
      .catch((e) => pushLog(`[kugou] listen history failed: ${e}`));
  }, [kugouLoggedIn, pushLog]);

  // Refresh token on startup (delayed)
  useEffect(() => {
    const t = window.setTimeout(() => {
      refreshTokenIfStale().catch(() => {});
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  return kugouLoggedIn;
}
