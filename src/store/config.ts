import type { StateCreator } from 'zustand';
import type { AppStore } from './index';
import type { Config } from '../types';
import { DEFAULT_SING_PREFIX } from '../types';

export interface ConfigSlice {
  config: Config;
  setConfig: (patch: Partial<Config>) => void;
  hydrateConfig: (cfg: Config) => void;
}

export const createConfigSlice: StateCreator<AppStore, [], [], ConfigSlice> = (set) => ({
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
});
