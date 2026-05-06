import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { insertHistory } from '../db';
import type { SidecarEvent } from '../types';
import { useAppStore } from '../store';

/**
 * Listens to sidecar events and dispatches to the store.
 * Also advances the startup checklist as each stage completes.
 * Blacklist enforcement happens in auto-sync / manual-add (post-KuGou-search),
 * so there is no frontend-side guard here. */
export function useSidecarEvents({ onReconnect }: { onReconnect?: () => void } = {}) {
  const addSong = useAppStore((s) => s.addSong);
  const cancelByUid = useAppStore((s) => s.cancelByUid);
  const setStatus = useAppStore((s) => s.setStatus);
  const pushLog = useAppStore((s) => s.pushLog);
  const sessionId = useAppStore((s) => s.sessionId);
  const setStartupStep = useAppStore((s) => s.setStartupStep);
  const running = useAppStore((s) => s.running);
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    const unlisten = listen<SidecarEvent>('sidecar-event', (e) => {
      const ev = e.payload;

      switch (ev.event) {
        case 'danmu':
          addSong(ev.data);
          if (sessionId) insertHistory(ev.data, sessionId).catch((err) => pushLog(`db: ${err}`));
          break;
        case 'cancel':
          cancelByUid(ev.uid);
          break;
        case 'status':
          setStatus({ connected: ev.connected, message: ev.message });
          if (running && ev.connected) setStartupStep('douyin', 'done');
          // Re-sync blacklist on reconnection
          if (ev.connected && !wasConnectedRef.current) {
            onReconnectRef.current?.();
          }
          wasConnectedRef.current = ev.connected;
          break;
        case 'log':
          pushLog(`[${ev.level}] ${ev.msg}`);
          break;
        case 'error':
          pushLog(`[error] ${ev.msg}`);
          break;
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addSong, cancelByUid, setStatus, pushLog, sessionId, setStartupStep, running]);
}
