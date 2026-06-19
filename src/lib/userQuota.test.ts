import { describe, it, expect } from 'vitest';
import { countAddedByUid, isOverUserLimit } from './userQuota';
import type { DanmuInfo } from '../types';

const song = (uid: string, overrides: Partial<DanmuInfo> = {}): DanmuInfo => ({
  msg_id: `${uid}_${Math.random()}`,
  uid,
  uname: uid,
  song_name: 'x',
  raw_msg: 'x',
  medal_level: 0,
  medal_name: '',
  send_time: 0,
  ...overrides,
});

describe('countAddedByUid', () => {
  it('counts played songs per uid', () => {
    const m = countAddedByUid([song('u1'), song('u1'), song('u2')]);
    expect(m.get('u1')).toBe(2);
    expect(m.get('u2')).toBe(1);
  });

  it('excludes manual host adds', () => {
    const m = countAddedByUid([song('manual'), song('manual'), song('u1')]);
    expect(m.has('manual')).toBe(false);
    expect(m.get('u1')).toBe(1);
  });

  it('returns empty map for no played songs', () => {
    expect(countAddedByUid([]).size).toBe(0);
  });
});

// Faithful model of the steady-state auto-sync outcome for the per-user limit:
// each tick picks the first queued song whose requester is not yet at the limit,
// moves it to `played`, and repeats until nothing is eligible. (Mirrors
// useAutoSync's find-first-eligible loop; blacklist/cooldown/search-status are
// out of scope for this scenario — all songs are assumed found & syncable.)
function simulateAutoSync(queue: DanmuInfo[], limit: number) {
  const remaining = [...queue];
  const played: DanmuInfo[] = [];
  for (;;) {
    const added = countAddedByUid(played);
    const idx = remaining.findIndex((s) => !isOverUserLimit(s, added, limit));
    if (idx === -1) break;
    played.push(remaining.splice(idx, 1)[0]);
  }
  return { played, remaining };
}

describe('auto-sync per-user limit simulation', () => {
  it('limit 3: caps user1 at 3, leaves the 4th in the queue', () => {
    // Request order: u1/歌曲1, u2/歌曲2, u3/歌曲3, u1/歌曲4, u3/歌曲5, u1/歌曲6, u1/歌曲7
    const requests: Array<[string, string]> = [
      ['1', '歌曲1'],
      ['2', '歌曲2'],
      ['3', '歌曲3'],
      ['1', '歌曲4'],
      ['3', '歌曲5'],
      ['1', '歌曲6'],
      ['1', '歌曲7'],
    ];
    const queue = requests.map(([uid, name], i) => song(uid, { song_name: name, send_time: i }));

    const { played, remaining } = simulateAutoSync(queue, 3);

    // 已点 (added to playlist): u1 gets its first 3 (歌曲1/4/6), u2 歌曲2, u3 歌曲3/5
    expect(played.map((s) => s.song_name)).toEqual([
      '歌曲1',
      '歌曲2',
      '歌曲3',
      '歌曲4',
      '歌曲5',
      '歌曲6',
    ]);
    // 点歌列表 (still queued): only u1's 4th request, skipped as over-limit
    expect(remaining.map((s) => s.song_name)).toEqual(['歌曲7']);
  });
});

describe('isOverUserLimit', () => {
  const limit = 3;

  it('not over below the limit', () => {
    const added = new Map([['u1', 2]]);
    expect(isOverUserLimit(song('u1'), added, limit)).toBe(false);
  });

  it('over at exactly the limit (3rd already added → 4th skipped)', () => {
    const added = new Map([['u1', 3]]);
    expect(isOverUserLimit(song('u1'), added, limit)).toBe(true);
  });

  it('over above the limit', () => {
    const added = new Map([['u1', 5]]);
    expect(isOverUserLimit(song('u1'), added, limit)).toBe(true);
  });

  it('limit 0 means unlimited', () => {
    const added = new Map([['u1', 99]]);
    expect(isOverUserLimit(song('u1'), added, 0)).toBe(false);
  });

  it('manual adds are never limited', () => {
    const added = new Map([['manual', 99]]);
    expect(isOverUserLimit(song('manual'), added, limit)).toBe(false);
  });

  it('a user with no added songs is not over', () => {
    expect(isOverUserLimit(song('u1'), new Map(), limit)).toBe(false);
  });
});
