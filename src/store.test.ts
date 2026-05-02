import { describe, it, expect, beforeEach } from 'vitest';
import { dedupedSongs, useAppStore } from './store';
import type { DanmuInfo } from './types';

const song = (over: Partial<DanmuInfo>): DanmuInfo => ({
  msg_id: 'm',
  uid: 'u',
  uname: 'n',
  song_name: 'song',
  raw_msg: 'raw',
  medal_level: 0,
  medal_name: '',
  send_time: 0,
  ...over,
});

describe('dedupedSongs', () => {
  it('returns empty for empty input', () => {
    expect(dedupedSongs([])).toEqual([]);
  });

  it('keeps single entry as-is', () => {
    const a = song({ msg_id: 'a', song_name: 'x', send_time: 1 });
    expect(dedupedSongs([a])).toEqual([a]);
  });

  it('keeps the earliest entry per song_name', () => {
    const earlier = song({ msg_id: 'a', uname: 'alice', song_name: '稻香', send_time: 100 });
    const later = song({ msg_id: 'b', uname: 'bob', song_name: '稻香', send_time: 200 });
    const out = dedupedSongs([earlier, later]);
    expect(out).toHaveLength(1);
    expect(out[0].msg_id).toBe('a');
    expect(out[0].uname).toBe('alice');
  });

  it('preserves distinct songs', () => {
    const a = song({ msg_id: '1', song_name: 'A', send_time: 1 });
    const b = song({ msg_id: '2', song_name: 'B', send_time: 2 });
    const out = dedupedSongs([a, b]);
    expect(out).toHaveLength(2);
  });

  it('returns earliest first (FCFS)', () => {
    const earlier = song({ msg_id: '1', song_name: 'A', send_time: 1 });
    const later = song({ msg_id: '2', song_name: 'B', send_time: 100 });
    const out = dedupedSongs([earlier, later]);
    expect(out[0].msg_id).toBe('1');
    expect(out[1].msg_id).toBe('2');
  });

  it('combines dedup + ordering', () => {
    // Three rows by time: 1=A, 2=B, 3=A (dup, drop), 4=C
    const inputs = [
      song({ msg_id: '1', song_name: 'A', send_time: 1 }),
      song({ msg_id: '2', song_name: 'B', send_time: 2 }),
      song({ msg_id: '3', song_name: 'A', send_time: 3 }), // duplicate of 1, dropped
      song({ msg_id: '4', song_name: 'C', send_time: 4 }),
    ];
    const out = dedupedSongs(inputs);
    expect(out.map((x) => x.msg_id)).toEqual(['1', '2', '4']);
  });

  it('places manual entries on top (newest-manual first), auto below (FCFS)', () => {
    const inputs = [
      song({ msg_id: 'a1', uid: 'u1', song_name: 'A', send_time: 1 }),
      song({ msg_id: 'm1', uid: 'manual', song_name: 'M1', send_time: 50 }),
      song({ msg_id: 'a2', uid: 'u2', song_name: 'B', send_time: 2 }),
      song({ msg_id: 'm2', uid: 'manual', song_name: 'M2', send_time: 60 }),
    ];
    const out = dedupedSongs(inputs);
    // M2 (newer manual) before M1 (older manual); A (earlier auto) before B
    expect(out.map((x) => x.msg_id)).toEqual(['m2', 'm1', 'a1', 'a2']);
  });

  it('manual entry wins over auto entry of the same song name', () => {
    const auto = song({ msg_id: 'a', uid: 'u1', song_name: '稻香', send_time: 1 });
    const manual = song({ msg_id: 'm', uid: 'manual', song_name: '稻香', send_time: 100 });
    const out = dedupedSongs([auto, manual]);
    expect(out).toHaveLength(1);
    expect(out[0].msg_id).toBe('m');
  });
});

// ─── Store actions ─────────────────────────────────────────────

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      songs: [],
      played: [],
      blacklist: new Map<string, number>(),
      autoSync: false,
    });
  });

  describe('songs', () => {
    it('addSong prepends', () => {
      const a = song({ msg_id: 'a', song_name: 'A', send_time: 1 });
      const b = song({ msg_id: 'b', song_name: 'B', send_time: 2 });
      useAppStore.getState().addSong(a);
      useAppStore.getState().addSong(b);
      expect(useAppStore.getState().songs.map((s) => s.msg_id)).toEqual(['b', 'a']);
    });

    it('removeByMsgId removes matching song', () => {
      useAppStore.getState().addSong(song({ msg_id: 'a', song_name: 'A' }));
      useAppStore.getState().addSong(song({ msg_id: 'b', song_name: 'B' }));
      useAppStore.getState().removeByMsgId('a');
      expect(useAppStore.getState().songs.map((s) => s.msg_id)).toEqual(['b']);
    });

    it('cancelByUid removes song by uid', () => {
      useAppStore.getState().addSong(song({ msg_id: 'a', uid: 'u1', song_name: 'A' }));
      useAppStore.getState().addSong(song({ msg_id: 'b', uid: 'u2', song_name: 'B' }));
      useAppStore.getState().cancelByUid('u1');
      expect(useAppStore.getState().songs.map((s) => s.msg_id)).toEqual(['b']);
    });

    it('clearSongs empties the list', () => {
      useAppStore.getState().addSong(song({ msg_id: 'a', song_name: 'A' }));
      useAppStore.getState().clearSongs();
      expect(useAppStore.getState().songs).toHaveLength(0);
    });

    it('manualAdd creates a manual entry with uid=manual and uname=Host', () => {
      const item = useAppStore.getState().manualAdd('测试歌曲');
      expect(item.uid).toBe('manual');
      expect(item.uname).toBe('Host');
      expect(item.song_name).toBe('测试歌曲');
      expect(useAppStore.getState().songs).toHaveLength(1);
    });
  });

  describe('played', () => {
    it('addPlayed attaches played_at and moves to played list', () => {
      const s = song({ msg_id: 'a', song_name: 'A' });
      useAppStore.getState().addPlayed(s);
      const played = useAppStore.getState().played;
      expect(played).toHaveLength(1);
      expect(played[0].msg_id).toBe('a');
      expect(played[0].played_at).toBeGreaterThan(0);
    });

    it('played songs are sorted by played_at descending', () => {
      const a = song({ msg_id: 'a', song_name: 'A' });
      const b = song({ msg_id: 'b', song_name: 'B' });
      useAppStore.getState().addPlayed(a);
      // Small delay so timestamps differ
      useAppStore.getState().addPlayed(b);
      const played = useAppStore.getState().played;
      expect(played[0].msg_id).toBe('b');
      expect(played[1].msg_id).toBe('a');
    });

    it('clearPlayed empties played list', () => {
      useAppStore.getState().addPlayed(song({ msg_id: 'a', song_name: 'A' }));
      useAppStore.getState().clearPlayed();
      expect(useAppStore.getState().played).toHaveLength(0);
    });
  });

  describe('blacklist', () => {
    it('addToBlacklist adds a name to the set', () => {
      useAppStore.getState().addToBlacklist('bad song');
      expect(useAppStore.getState().blacklist.has('bad song')).toBe(true);
    });

    it('removeFromBlacklist removes a name', () => {
      useAppStore.getState().addToBlacklist('bad song');
      useAppStore.getState().removeFromBlacklist('bad song');
      expect(useAppStore.getState().blacklist.has('bad song')).toBe(false);
    });

    it('hydrateBlacklist replaces the set', () => {
      useAppStore.getState().hydrateBlacklist([{song_name: 'a', created_at: 123}, {song_name: 'b', created_at: 123}, {song_name: 'c', created_at: 123}]);
      expect(useAppStore.getState().blacklist.size).toBe(3);
      expect(useAppStore.getState().blacklist.has('a')).toBe(true);
    });

    it('blacklist set is independent per add (no mutation of previous)', () => {
      useAppStore.getState().hydrateBlacklist([{song_name: 'x', created_at: 123}]);
      const first = useAppStore.getState().blacklist;
      useAppStore.getState().addToBlacklist('y');
      expect(first.has('y')).toBe(false);
    });
  });

  describe('autoSync', () => {
    it('defaults to false', () => {
      expect(useAppStore.getState().autoSync).toBe(false);
    });

    it('setAutoSync toggles value', () => {
      useAppStore.getState().setAutoSync(true);
      expect(useAppStore.getState().autoSync).toBe(true);
      useAppStore.getState().setAutoSync(false);
      expect(useAppStore.getState().autoSync).toBe(false);
    });
  });
});
