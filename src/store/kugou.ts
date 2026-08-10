import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export interface KugouSlice {
  preferCumulative: boolean;
  setPreferCumulative: (v: boolean) => void;
  autoSync: boolean;
  setAutoSync: (v: boolean) => void;
}

export const createKugouSlice: StateCreator<AppStore, [], [], KugouSlice> = (set) => ({
  preferCumulative: (() => {
    try {
      const v = localStorage.getItem('sususongboard.kugou-prefer-cumulative');
      if (v === null) return true;
      return v === '1';
    } catch {
      return true;
    }
  })(),
  setPreferCumulative: (v) => {
    try {
      localStorage.setItem('sususongboard.kugou-prefer-cumulative', v ? '1' : '0');
    } catch {}
    set({ preferCumulative: v });
  },

  autoSync: false,
  setAutoSync: (v) => set({ autoSync: v }),
});
