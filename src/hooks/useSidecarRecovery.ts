import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store';
import { SidecarEventSchema } from '../types';
import { track } from '../telemetry';

/**
 * Watches for sidecar 'crashed' events and auto-restarts the sidecar process
 * with exponential backoff (2s → 4s → 8s → 16s → 32s, capped at 60s).
 * If the user was running, re-sends the start command after respawn so the
 * live room reconnects automatically.
 */
export function useSidecarRecovery({
  syncBlacklist,
}: {
  syncBlacklist: () => void;
}) {
  const config = useAppStore((s) => s.config);
  const running = useAppStore((s) => s.running);
  const setRunning = useAppStore((s) => s.setRunning);
  const pushLog = useAppStore((s) => s.pushLog);
  const blacklist = useAppStore((s) => s.blacklist);

  const configRef = useRef(config);
  const runningRef = useRef(running);
  const blacklistRef = useRef(blacklist);
  configRef.current = config;
  runningRef.current = running;
  blacklistRef.current = blacklist;

  const attemptRef = useRef(0);

  useEffect(() => {
    const unlisten = listen<unknown>('sidecar-event', async (e) => {
      const result = SidecarEventSchema.safeParse(e.payload);
      if (!result.success) return; // useSidecarEvents already logs the violation
      const ev = result.data;
      if (ev.event === 'status' && ev.connected) {
        // Successful connection — reset backoff
        attemptRef.current = 0;
        return;
      }
      if (ev.event !== 'crashed') return;

      const wasRunning = runningRef.current;
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      const delay = Math.min(2000 * 2 ** (attempt - 1), 60000);
      pushLog(`[recovery] sidecar crashed, retry in ${delay / 1000}s (attempt ${attempt})`);
      track('sidecar_crashed', { attempt, was_running: wasRunning });

      await new Promise((r) => setTimeout(r, delay));

      try {
        await invoke('sidecar_respawn');
        pushLog('[recovery] sidecar respawned');
      } catch (err) {
        pushLog(`[recovery] respawn failed: ${err}`);
        return;
      }

      if (!wasRunning) return;

      // Re-send start command to reconnect to the live room
      try {
        const blacklistNames = blacklistRef.current
          .filter((b) => b.entryType === 'song' && b.songName)
          .map((b) => b.songName);
        await invoke('sidecar_send', {
          cmd: { cmd: 'start', config: { ...configRef.current, blacklist: blacklistNames } },
        });
        pushLog('[recovery] reconnected to room');
      } catch (err) {
        pushLog(`[recovery] reconnect failed: ${err}`);
        setRunning(false);
      }
      // Sync blacklist after reconnect
      syncBlacklist();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [pushLog, setRunning, syncBlacklist]);
}
