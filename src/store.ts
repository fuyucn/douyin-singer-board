import { create } from 'zustand';
import type { Config, DanmuInfo } from './types';
import { DEFAULT_SING_PREFIX } from './types';

interface AppStore {
  // Config
  config: Config;
  setConfig: (patch: Partial<Config>) => void;
  hydrateConfig: (cfg: Config) => void;

  // Run state
  running: boolean;
  setRunning: (r: boolean) => void;
  sessionId: string;
  newSession: () => string;

  // Connection status
  status: { connected: boolean; message: string };
  setStatus: (s: { connected: boolean; message?: string }) => void;

  // Songs in the current session
  songs: DanmuInfo[];
  addSong: (s: DanmuInfo) => void;
  cancelByUid: (uid: string) => void;
  removeByMsgId: (msgId: string) => void;
  clearSongs: () => void;
  manualAdd: (name: string) => DanmuInfo;
  setSongs: (list: DanmuInfo[]) => void;

  // Simple log buffer
  logs: string[];
  pushLog: (line: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  config: {
    room_id: '',
    sing_prefix: DEFAULT_SING_PREFIX,
    fans_level: 0,
    sing_cd: 60,
    target_playlist_name: '',
    target_playlist_id: 0,
  },
  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  hydrateConfig: (cfg) => set({ config: cfg }),

  running: false,
  setRunning: (r) => set({ running: r }),
  sessionId: '',
  newSession: () => {
    const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    set({ sessionId: id });
    return id;
  },

  status: { connected: false, message: 'Disconnected' },
  setStatus: (s) =>
    set({
      status: {
        connected: s.connected,
        message: s.message ?? (s.connected ? 'Connected' : 'Disconnected'),
      },
    }),

  songs: [],
  addSong: (s) => set((state) => ({ songs: [s, ...state.songs] })),
  cancelByUid: (uid) =>
    set((state) => {
      const idx = state.songs.findIndex((x) => x.uid === uid);
      if (idx < 0) return {};
      const next = [...state.songs];
      next.splice(idx, 1);
      return { songs: next };
    }),
  removeByMsgId: (msgId) =>
    set((state) => ({ songs: state.songs.filter((x) => x.msg_id !== msgId) })),
  clearSongs: () => set({ songs: [] }),
  manualAdd: (name) => {
    const now = Math.floor(Date.now() / 1000);
    const item: DanmuInfo = {
      msg_id: `manual_${now}_${Math.random().toString(36).slice(2, 6)}`,
      uid: 'manual',
      uname: 'Host',
      song_name: name,
      raw_msg: name,
      medal_level: 0,
      medal_name: '',
      send_time: now,
    };
    set((state) => ({ songs: [item, ...state.songs] }));
    return item;
  },
  setSongs: (list) => set({ songs: list }),

  logs: [],
  pushLog: (line) => set((s) => ({ logs: [...s.logs.slice(-99), line] })),
}));

// Dedup by song name. Display order:
//   1) manual entries (added by host) on top, newest-manual first
//   2) auto-matched chat entries below, FCFS (earliest first)
// When both a manual and an auto entry exist for the same song name, the manual one wins.
const isManual = (d: DanmuInfo): boolean => d.uid === 'manual';

export function dedupedSongs(songs: DanmuInfo[]): DanmuInfo[] {
  const seen = new Map<string, DanmuInfo>();
  for (const s of songs) {
    const existing = seen.get(s.song_name);
    if (!existing) {
      seen.set(s.song_name, s);
    } else if (isManual(s) && !isManual(existing)) {
      seen.set(s.song_name, s); // upgrade to manual
    } else if (!isManual(s) && isManual(existing)) {
      // keep existing manual
    } else if (s.send_time < existing.send_time) {
      // both same kind: keep earliest
      seen.set(s.song_name, s);
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    const aM = isManual(a) ? 0 : 1;
    const bM = isManual(b) ? 0 : 1;
    if (aM !== bM) return aM - bM; // manual group first
    if (aM === 0) return b.send_time - a.send_time; // newest manual first
    return a.send_time - b.send_time; // auto: FCFS earliest first
  });
}
