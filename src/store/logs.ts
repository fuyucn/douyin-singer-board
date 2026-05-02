import type { StateCreator } from 'zustand';
import type { AppStore } from './index';
import type { BlacklistEntry } from '../db';

export interface LogSlice {
  logs: string[];
  pushLog: (line: string) => void;
  clearLogs: () => void;
  // map: song_name -> created_at (unix seconds)
  blacklist: Map<string, number>;
  hydrateBlacklist: (entries: BlacklistEntry[]) => void;
  addToBlacklist: (name: string, createdAt?: number) => void;
  removeFromBlacklist: (name: string) => void;
}

export const createLogSlice: StateCreator<AppStore, [], [], LogSlice> = (set) => ({
  logs: [],
  pushLog: (line) => set((s) => ({ logs: [...s.logs.slice(-499), line] })),
  clearLogs: () => set({ logs: [] }),

  blacklist: new Map<string, number>(),
  hydrateBlacklist: (entries) =>
    set({ blacklist: new Map(entries.map((e) => [e.song_name, e.created_at])) }),
  addToBlacklist: (name, createdAt) =>
    set((state) => {
      const next = new Map(state.blacklist);
      next.set(name, createdAt ?? Math.floor(Date.now() / 1000));
      return { blacklist: next };
    }),
  removeFromBlacklist: (name) =>
    set((state) => {
      const next = new Map(state.blacklist);
      next.delete(name);
      return { blacklist: next };
    }),
});
