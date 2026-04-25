import { describe, it, expect } from 'vitest';
import { Matcher } from './matcher.js';
import type { Config } from './types.js';

const baseConfig = (overrides: Partial<Config> = {}): Config => ({
  room_id: 'x',
  sing_prefix: '点歌[space][song]',
  sing_cd: 0,
  fans_level: 0,
  ...overrides,
});

const raw = (content: string, overrides = {}) => ({
  uid: 'u1',
  uname: 'alice',
  content,
  medal_level: 0,
  medal_name: '',
  ...overrides,
});

describe('Matcher.templateToRegex', () => {
  it('compiles standard template', () => {
    const re = Matcher.templateToRegex('点歌[space][song]');
    expect(re.source).toBe('^点歌\\s+(.+?)$');
  });

  it('collapses consecutive [space] placeholders', () => {
    const re = Matcher.templateToRegex('点歌[space][space][song]');
    expect(re.source).toBe('^点歌\\s+(.+?)$');
  });

  it('treats literal characters literally', () => {
    const re = Matcher.templateToRegex('点歌:[song]');
    expect(re.source).toBe('^点歌:(.+?)$');
  });

  it('escapes regex metacharacters in literals', () => {
    const re = Matcher.templateToRegex('点歌.[song]');
    expect(re.source).toBe('^点歌\\.(.+?)$');
  });

  it('accepts legacy Chinese placeholders', () => {
    const re = Matcher.templateToRegex('点歌[空格][歌曲]');
    expect(re.source).toBe('^点歌\\s+(.+?)$');
  });

  it('case-insensitive English placeholders', () => {
    const re = Matcher.templateToRegex('点歌[SPACE][SONG]');
    expect(re.source).toBe('^点歌\\s+(.+?)$');
  });
});

describe('Matcher.match - prefix matching', () => {
  it('matches a valid song request', () => {
    const m = new Matcher(baseConfig());
    const r = m.match(raw('点歌 周杰伦'));
    expect(r.kind).toBe('song');
    if (r.kind === 'song') expect(r.danmu.song_name).toBe('周杰伦');
  });

  it('accepts multiple whitespaces (\\s+)', () => {
    const m = new Matcher(baseConfig());
    const r = m.match(raw('点歌    稻香'));
    if (r.kind !== 'song') throw new Error('expected song');
    expect(r.danmu.song_name).toBe('稻香');
  });

  it('rejects message without separator when template requires one', () => {
    const m = new Matcher(baseConfig());
    expect(m.match(raw('点歌周杰伦')).kind).toBe('skip');
  });

  it('rejects unrelated message', () => {
    const m = new Matcher(baseConfig());
    expect(m.match(raw('你好')).kind).toBe('skip');
  });

  it('rejects empty song name', () => {
    const m = new Matcher(baseConfig({ sing_prefix: '点歌[space][song]' }));
    // 点歌 followed by only whitespace -> [song] would have to be empty
    const r = m.match(raw('点歌  '));
    expect(r.kind).toBe('skip');
  });

  it('strict colon template rejects whitespace separator', () => {
    const m = new Matcher(baseConfig({ sing_prefix: '点歌:[song]' }));
    expect(m.match(raw('点歌 周杰伦')).kind).toBe('skip');
    const r = m.match(raw('点歌:周杰伦'));
    if (r.kind !== 'song') throw new Error('expected song');
    expect(r.danmu.song_name).toBe('周杰伦');
  });

  it('trims captured song name', () => {
    const m = new Matcher(baseConfig({ sing_prefix: '点歌:[song]' }));
    const r = m.match(raw('点歌:  周杰伦  '));
    if (r.kind !== 'song') throw new Error('expected song');
    expect(r.danmu.song_name).toBe('周杰伦');
  });
});

describe('Matcher.match - cancel', () => {
  it('detects cancel command', () => {
    const m = new Matcher(baseConfig());
    const r = m.match(raw('取消点歌'));
    expect(r.kind).toBe('cancel');
    if (r.kind === 'cancel') expect(r.uid).toBe('u1');
  });

  it('cancel resets cooldown for that uid', () => {
    const m = new Matcher(baseConfig({ sing_cd: 60 }));
    expect(m.match(raw('点歌 a')).kind).toBe('song');
    expect(m.match(raw('点歌 b')).kind).toBe('skip'); // cooldown
    expect(m.match(raw('取消点歌')).kind).toBe('cancel');
    expect(m.match(raw('点歌 c')).kind).toBe('song'); // cd cleared
  });
});

describe('Matcher.match - filters', () => {
  it('rejects below fans_level', () => {
    const m = new Matcher(baseConfig({ fans_level: 5 }));
    const r = m.match(raw('点歌 a', { medal_level: 3 }));
    expect(r.kind).toBe('skip');
    if (r.kind === 'skip') expect(r.reason).toMatch(/fans level/);
  });

  it('accepts at exactly fans_level', () => {
    const m = new Matcher(baseConfig({ fans_level: 5 }));
    expect(m.match(raw('点歌 a', { medal_level: 5 })).kind).toBe('song');
  });

  it('rejects within cooldown window', () => {
    const m = new Matcher(baseConfig({ sing_cd: 60 }));
    expect(m.match(raw('点歌 a')).kind).toBe('song');
    expect(m.match(raw('点歌 b')).kind).toBe('skip');
  });

  it('different uids do not share cooldown', () => {
    const m = new Matcher(baseConfig({ sing_cd: 60 }));
    expect(m.match(raw('点歌 a', { uid: 'u1' })).kind).toBe('song');
    expect(m.match(raw('点歌 b', { uid: 'u2' })).kind).toBe('song');
  });
});
