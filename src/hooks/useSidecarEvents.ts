import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { insertHistory } from '../db';
import type { SidecarEvent } from '../types';
import { useAppStore } from '../store';

interface Options {
  blacklist: Set<string>;
}

/**
 * Listens to sidecar events and dispatches to the store.
 */
export function useSidecarEvents({ blacklist }: Options) {
  const addSong = useAppStore((s) => s.addSong);
  const cancelByUid = useAppStore((s) => s.cancelByUid);
  const setStatus = useAppStore((s) => s.setStatus);
  const pushLog = useAppStore((s) => s.pushLog);
  const sessionId = useAppStore((s) => s.sessionId);

  useEffect(() => {
    const unlisten = listen<SidecarEvent>('sidecar-event', (e) => {
      const ev = e.payload;
      switch (ev.event) {
        case 'danmu':
          if (blacklist.has(ev.data.song_name)) break;
          addSong(ev.data);
          if (sessionId) insertHistory(ev.data, sessionId).catch((err) => pushLog(`db: ${err}`));
          break;
        case 'cancel':
          cancelByUid(ev.uid);
          break;
        case 'status':
          setStatus({ connected: ev.connected, message: ev.message });
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
  }, [addSong, cancelByUid, setStatus, pushLog, sessionId, blacklist]);
}
