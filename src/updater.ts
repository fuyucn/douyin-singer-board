// Lightweight update checker. Hits GitHub Releases API on startup, compares
// the latest tag with the current app version. Public repo, no auth.
//
// Channel-aware: pre-release builds only see newer pre-releases;
// stable builds only see newer stable releases.

import { open } from '@tauri-apps/plugin-shell';

declare const __APP_VERSION__: string;

const REPO = 'fuyucn/douyin-singer-board';
const SKIP_KEY = 'sususongboard.skipped-update-tag';

export interface UpdateInfo {
  tag: string;
  htmlUrl: string;
  body: string;
  publishedAt: string;
}

export const CURRENT_VERSION: string = __APP_VERSION__;

const isPrerelease = (v: string): boolean => v.includes('-');

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const currentPrerelease = isPrerelease(CURRENT_VERSION);

    let latestTag: string;
    let htmlUrl: string;
    let body: string;
    let publishedAt: string;

    if (currentPrerelease) {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases?per_page=30`,
        { headers: { Accept: 'application/vnd.github+json' } },
      );
      if (!res.ok) return null;
      const releases: any[] = await res.json();
      const prereleases = releases.filter((r: any) => r.prerelease === true);
      if (prereleases.length === 0) return null;

      prereleases.sort(
        (a: any, b: any) => -compareFullSemver(String(a.tag_name).replace(/^v/, ''), String(b.tag_name).replace(/^v/, '')),
      );
      const latest = prereleases[0];
      latestTag = String(latest.tag_name ?? '');
      htmlUrl = String(latest.html_url ?? '');
      body = String(latest.body ?? '');
      publishedAt = String(latest.published_at ?? '');
    } else {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      latestTag = String(data.tag_name ?? '');
      htmlUrl = String(data.html_url ?? '');
      body = String(data.body ?? '');
      publishedAt = String(data.published_at ?? '');
    }

    const latest = latestTag.replace(/^v/, '');
    if (!latest) return null;
    if (compareFullSemver(latest, CURRENT_VERSION) <= 0) return null;

    if (typeof localStorage !== 'undefined' && localStorage.getItem(SKIP_KEY) === latestTag) {
      return null;
    }
    return { tag: latestTag, htmlUrl, body, publishedAt };
  } catch {
    return null;
  }
}

export function skipVersion(tag: string): void {
  if (typeof localStorage === 'undefined' || !tag) return;
  localStorage.setItem(SKIP_KEY, tag);
}

export function clearSkippedVersion(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(SKIP_KEY);
}

export function getSkippedVersion(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(SKIP_KEY);
}

export async function openInBrowser(url: string): Promise<void> {
  if (!url) return;
  await open(url);
}

export function compareFullSemver(a: string, b: string): number {
  const [baseA, preA] = a.split('-');
  const [baseB, preB] = b.split('-');
  const cmp = compareSemver(baseA, baseB);
  if (cmp !== 0) return cmp;
  const nA = preA !== undefined ? parseInt(preA, 10) || 0 : -1;
  const nB = preB !== undefined ? parseInt(preB, 10) || 0 : -1;
  return nA - nB;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
