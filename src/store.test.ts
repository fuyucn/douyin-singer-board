import { describe, it, expect } from 'vitest';
import { dedupedSongs } from './store';
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

  it('returns newest first', () => {
    const old = song({ msg_id: '1', song_name: 'A', send_time: 1 });
    const fresh = song({ msg_id: '2', song_name: 'B', send_time: 100 });
    const out = dedupedSongs([old, fresh]);
    expect(out[0].msg_id).toBe('2');
    expect(out[1].msg_id).toBe('1');
  });

  it('combines dedup + ordering', () => {
    // 三条按时间: 1=A, 2=B, 3=A(dup, drop), 4=C
    const inputs = [
      song({ msg_id: '1', song_name: 'A', send_time: 1 }),
      song({ msg_id: '2', song_name: 'B', send_time: 2 }),
      song({ msg_id: '3', song_name: 'A', send_time: 3 }), // duplicate of 1, dropped
      song({ msg_id: '4', song_name: 'C', send_time: 4 }),
    ];
    const out = dedupedSongs(inputs);
    expect(out.map((x) => x.msg_id)).toEqual(['4', '2', '1']);
  });
});
