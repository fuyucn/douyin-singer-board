import type { StateCreator } from 'zustand';
import type { AppStore } from './index';
import type { DanmuInfo } from '../types';

export interface SongsSlice {
  songs: DanmuInfo[];
  addSong: (s: DanmuInfo) => void;
  cancelByUid: (uid: string) => void;
  removeByMsgId: (msgId: string) => void;
  clearSongs: () => void;
  manualAdd: (name: string) => DanmuInfo;
  played: DanmuInfo[];
  addPlayed: (song: DanmuInfo) => void;
  removePlayed: (msgId: string) => void;
  clearPlayed: () => void;
}

export const createSongsSlice: StateCreator<AppStore, [], [], SongsSlice> = (set) => ({
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

  played: [],
  addPlayed: (song) =>
    set((s) => {
      const item = { ...song, played_at: Math.floor(Date.now() / 1000) };
      const next = [item, ...s.played].sort((a, b) => (b.played_at ?? 0) - (a.played_at ?? 0));
      return { played: next };
    }),
  removePlayed: (msgId) => set((s) => ({ played: s.played.filter((x) => x.msg_id !== msgId) })),
  clearPlayed: () => set({ played: [] }),
});
