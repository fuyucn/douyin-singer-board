import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

// Re-export for backwards compatibility — BlacklistItem now lives in ./blacklist.
export type { BlacklistItem } from './blacklist';

export interface LogSlice {
  logs: string[];
  pushLog: (line: string) => void;
  clearLogs: () => void;
}

export const createLogSlice: StateCreator<AppStore, [], [], LogSlice> = (set) => ({
  logs: [],
  pushLog: (line) =>
    set((s) => {
      const logs = s.logs;
      const next = logs.length >= 500 ? [...logs.slice(-499), line] : [...logs, line];
      return { logs: next };
    }),
  clearLogs: () => set({ logs: [] }),
});
