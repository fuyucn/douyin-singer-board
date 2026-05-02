import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export interface LogSlice {
  logs: string[];
  pushLog: (line: string) => void;
  blacklist: Set<string>;
  hydrateBlacklist: (names: string[]) => void;
  addToBlacklist: (name: string) => void;
  removeFromBlacklist: (name: string) => void;
}

export const createLogSlice: StateCreator<AppStore, [], [], LogSlice> = (set) => ({
  logs: [],
  pushLog: (line) => set((s) => ({ logs: [...s.logs.slice(-99), line] })),

  blacklist: new Set<string>(),
  hydrateBlacklist: (names) => set({ blacklist: new Set(names) }),
  addToBlacklist: (name) =>
    set((state) => {
      const next = new Set(state.blacklist);
      next.add(name);
      return { blacklist: next };
    }),
  removeFromBlacklist: (name) =>
    set((state) => {
      const next = new Set(state.blacklist);
      next.delete(name);
      return { blacklist: next };
    }),
});
