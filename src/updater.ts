// Lightweight update checker. Hits GitHub Releases API on startup, compares
// the latest tag with the current app version. Public repo, no auth.
//
// The repo location is hardcoded here for the update fetch. We deliberately
// don't surface it as a UI link — the About modal shows only the version,
// and the "前往下载" button opens whatever release URL the API hands back.

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

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const tag = String(data.tag_name ?? '');
    const latest = tag.replace(/^v/, '');
    if (!latest) return null;
    if (compareSemver(latest, CURRENT_VERSION) <= 0) return null;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(SKIP_KEY) === tag) {
      return null;
    }
    return {
      tag,
      htmlUrl: String(data.html_url ?? ''),
      body: String(data.body ?? ''),
      publishedAt: String(data.published_at ?? ''),
    };
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

// >0 if a > b, <0 if smaller, 0 if equal. Strips pre-release suffixes.
export function compareSemver(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}
