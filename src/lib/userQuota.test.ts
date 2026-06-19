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
