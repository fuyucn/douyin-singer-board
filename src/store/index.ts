import { create } from 'zustand';
import type { DanmuInfo } from '../types';
import type { ConfigSlice } from './config';
import type { ConnectionSlice } from './connection';
import type { SongsSlice } from './songs';
import type { KugouSlice } from './kugou';
import type { LogSlice } from './logs';
import { createConfigSlice } from './config';
import { createConnectionSlice } from './connection';
import { createSongsSlice } from './songs';
import { createKugouSlice } from './kugou';
import { createLogSlice } from './logs';

export type AppStore = ConfigSlice & ConnectionSlice & SongsSlice & KugouSlice & LogSlice;

export const useAppStore = create<AppStore>()((...a) => ({
  ...createConfigSlice(...a),
  ...createConnectionSlice(...a),
  ...createSongsSlice(...a),
  ...createKugouSlice(...a),
  ...createLogSlice(...a),
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
