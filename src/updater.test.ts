import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareFullSemver, githubApi, parseSha256Digest, resetGithubApiRoute } from './updater';

describe('compareFullSemver', () => {
  it('orders susu custom builds by their numeric counter', () => {
    expect(compareFullSemver('0.41.0-susu.1', '0.41.0-susu.2')).toBeLessThan(0);
    expect(compareFullSemver('0.41.0-susu.2', '0.41.0-susu.1')).toBeGreaterThan(0);
    expect(compareFullSemver('0.41.0-susu.10', '0.41.0-susu.2')).toBeGreaterThan(0);
  });

  it('orders legacy numeric suffixes numerically', () => {
    expect(compareFullSemver('0.0.40-7', '0.0.40-8')).toBeLessThan(0);
    expect(compareFullSemver('0.0.40-10', '0.0.40-2')).toBeGreaterThan(0);
  });

  it('orders by base version before the suffix', () => {
    expect(compareFullSemver('0.41.0-susu.9', '0.42.0-susu.1')).toBeLessThan(0);
    expect(compareFullSemver('0.42.0', '0.41.0')).toBeGreaterThan(0);
  });

  it('treats identical versions as equal', () => {
    expect(compareFullSemver('0.41.0-susu.3', '0.41.0-susu.3')).toBe(0);
  });
});

describe('parseSha256Digest', () => {
  it('extracts a lowercase hex digest', () => {
    const hex = 'D7232F9DD470D352FE3E60236684B206018E7053D9A394A7FB9BF5F2B579232F';
    expect(parseSha256Digest(`sha256:${hex}`)).toBe(hex.toLowerCase());
  });

  it('rejects missing or malformed digests', () => {
    expect(parseSha256Digest(undefined)).toBeNull();
    expect(parseSha256Digest('sha1:abc')).toBeNull();
    expect(parseSha256Digest('sha256:xyz')).toBeNull();
  });
});

describe('githubApi', () => {
  const PATH = '/repos/o/r/releases/latest';
  const DIRECT = `https://api.github.com${PATH}`;
  const PROXIED = `https://gh-proxy.com/${DIRECT}`;

  beforeEach(() => resetGithubApiRoute());
  afterEach(() => vi.unstubAllGlobals());

  it('uses the direct API when it works', async () => {
    const fetchMock = vi.fn(async () => new Response('{"tag_name":"v1"}'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await githubApi(PATH)).toEqual({ tag_name: 'v1' });
    expect(fetchMock.mock.calls.map((c: any[]) => c[0])).toEqual([DIRECT]);
  });

  it('falls back to gh-proxy and keeps preferring it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === DIRECT) throw new TypeError('network');
      return new Response('{"tag_name":"v2"}');
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await githubApi(PATH)).toEqual({ tag_name: 'v2' });
    expect(await githubApi(PATH)).toEqual({ tag_name: 'v2' });
    expect(fetchMock.mock.calls.map((c: any[]) => c[0])).toEqual([DIRECT, PROXIED, PROXIED]);
  });

  it('returns null when both routes fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    expect(await githubApi(PATH)).toBeNull();
  });
});
