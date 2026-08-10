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
      blacklist: [],
      blockedSongKeys: new Set<string>(),
      blockedSingers: new Set<string>(),
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
    const songEntry = (
      over?: Partial<{ id: number; songName: string; singerName: string; createdAt: number }>,
    ) => ({
      id: over?.id ?? 1,
      entryType: 'song' as const,
      songName: over?.songName ?? 'bad song',
      singerName: over?.singerName ?? 'Test Singer',
      createdAt: over?.createdAt ?? 123,
    });

    const singerEntry = (
      over?: Partial<{ id: number; singerName: string; createdAt: number }>,
    ) => ({
      id: over?.id ?? 1,
      entryType: 'singer' as const,
      songName: '',
      singerName: over?.singerName ?? 'Blocked Singer',
      createdAt: over?.createdAt ?? 123,
    });

    it('addSongToBlacklist prepends item and updates blockedSongKeys', () => {
      const item = songEntry({ songName: 'bad', singerName: 'S' });
      useAppStore.getState().addSongToBlacklist(item);
      expect(useAppStore.getState().blacklist).toHaveLength(1);
      expect(useAppStore.getState().blacklist[0].songName).toBe('bad');
      expect(useAppStore.getState().blockedSongKeys.has('bad|S')).toBe(true);
    });

    it('addSingerToBlacklist prepends item and updates blockedSingers', () => {
      const item = singerEntry({ singerName: 'Blocked' });
      useAppStore.getState().addSingerToBlacklist(item);
      expect(useAppStore.getState().blacklist).toHaveLength(1);
      expect(useAppStore.getState().blacklist[0].entryType).toBe('singer');
      expect(useAppStore.getState().blockedSingers.has('Blocked')).toBe(true);
    });

    it('removeFromBlacklist removes by id and rebuilds sets', () => {
      useAppStore
        .getState()
        .addSongToBlacklist(songEntry({ id: 1, songName: 'a', singerName: 'SA' }));
      useAppStore
        .getState()
        .addSongToBlacklist(songEntry({ id: 2, songName: 'b', singerName: 'SB' }));
      useAppStore.getState().removeFromBlacklist(1);
      expect(useAppStore.getState().blacklist).toHaveLength(1);
      expect(useAppStore.getState().blacklist[0].id).toBe(2);
      expect(useAppStore.getState().blockedSongKeys.has('a|SA')).toBe(false);
      expect(useAppStore.getState().blockedSongKeys.has('b|SB')).toBe(true);
    });

    it('hydrateBlacklist builds array and both sets', () => {
      useAppStore.getState().hydrateBlacklist([
        { id: 1, entry_type: 'song', song_name: 'x', singer_name: 'SX', created_at: 1 },
        { id: 2, entry_type: 'singer', song_name: '', singer_name: 'SY', created_at: 2 },
      ]);
      expect(useAppStore.getState().blacklist).toHaveLength(2);
      expect(useAppStore.getState().blacklist[0].entryType).toBe('song');
      expect(useAppStore.getState().blacklist[1].entryType).toBe('singer');
      expect(useAppStore.getState().blockedSongKeys.has('x|SX')).toBe(true);
      expect(useAppStore.getState().blockedSingers.has('SY')).toBe(true);
    });

    it('blockedSongKeys is independent per add (no mutation of previous)', () => {
      useAppStore
        .getState()
        .hydrateBlacklist([
          { id: 1, entry_type: 'song', song_name: 'x', singer_name: 'SX', created_at: 1 },
        ]);
      const first = useAppStore.getState().blockedSongKeys;
      useAppStore
        .getState()
        .addSongToBlacklist(songEntry({ id: 2, songName: 'y', singerName: 'SY' }));
      expect(first.has('y|SY')).toBe(false);
    });
  });

  describe('logs', () => {
    beforeEach(() => {
      useAppStore.setState({ logs: [] });
    });

    it('pushLog keeps max 500 entries', () => {
      const state = useAppStore.getState();
      for (let i = 0; i < 510; i++) {
        state.pushLog(`line ${i}`);
      }
      expect(useAppStore.getState().logs).toHaveLength(500);
    });

    it('clearLogs resets to empty array', () => {
      useAppStore.getState().pushLog('a');
      useAppStore.getState().pushLog('b');
      useAppStore.getState().clearLogs();
      expect(useAppStore.getState().logs).toEqual([]);
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
