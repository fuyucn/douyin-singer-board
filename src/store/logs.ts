import type { StateCreator } from 'zustand';
import type { AppStore } from './index';
import type { BlacklistEntry } from '../db';

export interface BlacklistItem {
  id: number;
  entryType: 'song' | 'singer';
  songName: string;
  singerName: string;
  createdAt: number;
}

export interface LogSlice {
  logs: string[];
  pushLog: (line: string) => void;
  clearLogs: () => void;
  // Full ordered list for UI rendering
  blacklist: BlacklistItem[];
  // O(1) lookup sets
  blockedSongKeys: Set<string>; // "songName|singerName"
  blockedSingers: Set<string>; // singerName
  hydrateBlacklist: (entries: BlacklistEntry[]) => void;
  addSongToBlacklist: (entry: BlacklistItem) => void;
  addSingerToBlacklist: (entry: BlacklistItem) => void;
  removeFromBlacklist: (id: number) => void;
}

function buildSets(items: BlacklistItem[]) {
  const songKeys = new Set<string>();
  const singers = new Set<string>();
  for (const item of items) {
    if (item.entryType === 'song') {
      songKeys.add(`${item.songName}|${item.singerName}`);
    } else {
      singers.add(item.singerName);
    }
  }
  return { blockedSongKeys: songKeys, blockedSingers: singers };
}

export const createLogSlice: StateCreator<AppStore, [], [], LogSlice> = (set) => ({
  logs: [],
  pushLog: (line) => set((s) => ({ logs: [...s.logs.slice(-499), line] })),
  clearLogs: () => set({ logs: [] }),

  blacklist: [],
  blockedSongKeys: new Set<string>(),
  blockedSingers: new Set<string>(),

  hydrateBlacklist: (entries) => {
    const items: BlacklistItem[] = entries.map((e) => ({
      id: e.id,
      entryType: e.entry_type,
      songName: e.song_name,
      singerName: e.singer_name,
      createdAt: e.created_at,
    }));
    set({ blacklist: items, ...buildSets(items) });
  },

  addSongToBlacklist: (entry) =>
    set((state) => {
      const items = [entry, ...state.blacklist];
      const songKeys = new Set(state.blockedSongKeys);
      songKeys.add(`${entry.songName}|${entry.singerName}`);
      return { blacklist: items, blockedSongKeys: songKeys };
    }),

  addSingerToBlacklist: (entry) =>
    set((state) => {
      const items = [entry, ...state.blacklist];
      const singers = new Set(state.blockedSingers);
      singers.add(entry.singerName);
      return { blacklist: items, blockedSingers: singers };
    }),

  removeFromBlacklist: (id) =>
    set((state) => {
      const items = state.blacklist.filter((item) => item.id !== id);
      return { blacklist: items, ...buildSets(items) };
    }),
});
