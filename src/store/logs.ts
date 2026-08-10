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
      // Stamp each line with the local wall-clock time at push, so the
      // LogPanel timestamp column always has a real HH:MM:SS to show.
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamped = /^\d{2}:\d{2}:\d{2}\b/.test(line)
        ? line
        : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${line}`;
      const logs = s.logs;
      const next = logs.length >= 500 ? [...logs.slice(-499), stamped] : [...logs, stamped];
      return { logs: next };
    }),
  clearLogs: () => set({ logs: [] }),
});
