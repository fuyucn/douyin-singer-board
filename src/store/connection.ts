import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export interface ConnectionSlice {
  running: boolean;
  setRunning: (r: boolean) => void;
  sessionId: string;
  newSession: () => string;
  status: { connected: boolean; message: string };
  setStatus: (s: { connected: boolean; message?: string }) => void;
  startupSteps: { key: string; label: string; status: 'pending' | 'done' }[];
  setStartupStep: (key: string, status: 'pending' | 'done') => void;
  resetStartupSteps: () => void;
}

export const createConnectionSlice: StateCreator<AppStore, [], [], ConnectionSlice> = (set) => ({
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
    set({
      status: {
        connected: s.connected,
        message: s.message ?? (s.connected ? 'Connected' : 'Disconnected'),
      },
    }),

  startupSteps: [
    { key: 'douyin', label: '连接抖音直播间', status: 'pending' },
    { key: 'kugou', label: '酷狗服务就绪', status: 'pending' },
  ],
  setStartupStep: (key, status) =>
    set((state) => ({
      startupSteps: state.startupSteps.map((s) => (s.key === key ? { ...s, status } : s)),
    })),
  resetStartupSteps: () =>
    set((state) => ({
      startupSteps: state.startupSteps.map((s) =>
        s.key === 'douyin' ? { ...s, status: 'pending' as const } : s,
      ),
    })),
});
