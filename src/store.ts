import { create } from 'zustand';
import type { Config, DanmuInfo } from './types';
import { DEFAULT_SING_PREFIX } from './types';

interface AppStore {
  // 配置
  config: Config;
  setConfig: (patch: Partial<Config>) => void;
  hydrateConfig: (cfg: Config) => void;

  // 运行状态
  running: boolean;
  setRunning: (r: boolean) => void;
  sessionId: string;
  newSession: () => string;

  // 连接状态
  status: { connected: boolean; message: string };
  setStatus: (s: { connected: boolean; message?: string }) => void;

  // 当前 session 的歌单
  songs: DanmuInfo[];
  addSong: (s: DanmuInfo) => void;
  cancelByUid: (uid: string) => void;
  removeByMsgId: (msgId: string) => void;
  clearSongs: () => void;
  manualAdd: (name: string) => DanmuInfo;
  setSongs: (list: DanmuInfo[]) => void;

  // 简易日志
  logs: string[];
  pushLog: (line: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  config: { room_id: '', sing_prefix: DEFAULT_SING_PREFIX, fans_level: 0, sing_cd: 60 },
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

  status: { connected: false, message: '未连接' },
  setStatus: (s) =>
    set({ status: { connected: s.connected, message: s.message ?? (s.connected ? '已连接' : '未连接') } }),

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
      uname: '主播',
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

// 同名去重: 相同 song_name 只保留最早 (send_time 最小) 那条, 显示按 send_time 倒序
export function dedupedSongs(songs: DanmuInfo[]): DanmuInfo[] {
  const seen = new Map<string, DanmuInfo>();
  const sorted = [...songs].sort((a, b) => a.send_time - b.send_time);
  for (const s of sorted) {
    if (!seen.has(s.song_name)) seen.set(s.song_name, s);
  }
  return Array.from(seen.values()).sort((a, b) => b.send_time - a.send_time);
}
