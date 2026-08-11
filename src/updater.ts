// Update utilities.
//
// checkForUpdate()         — channel-aware GitHub Releases API check (no side effects).
//                            Pre-release builds see newer pre-releases; stable sees stable.
// installAppUpdate()       — macOS: downloads via tauri-plugin-updater (Ed25519 verified).
//                            Windows portable: downloads new .exe directly, queues a
//                            PowerShell self-replace script, returns Ok.
//                            Emits progress events during download.
//                            Returns when download+queue is complete; caller prompts restart.
// relaunchApp()            — macOS: restarts the process (tauri-plugin-process).
// exitForUpdate()          — Windows: exits cleanly so the PS script can copy the new exe.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';

declare const __APP_VERSION__: string;

const REPO = 'fuyucn/douyin-singer-board';
const SKIP_KEY = 'sususongboard.skipped-update-tag';

/**
 * Release builds set VITE_UPDATER_ENABLED=true (with signing keys in CI).
 * Local/unsigned builds keep the feature off so the UI never claims updates
 * are available when no signed artifacts are produced.
 */
export const updaterEnabled = import.meta.env.VITE_UPDATER_ENABLED === 'true';

export interface UpdateInfo {
  tag: string;
  htmlUrl: string;
  body: string;
  publishedAt: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

export interface DiagEntry {
  ts: string; // HH:mm:ss.ms
  version: string; // running app version
  msg: string;
}

function diagEntry(msg: string): DiagEntry {
  const now = new Date();
  const ts = now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  return { ts, version: CURRENT_VERSION, msg };
}

export const CURRENT_VERSION: string = __APP_VERSION__;

/** True when the OS is Windows (any distribution). */
export const isWindows = (): boolean =>
  typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);

const isPrerelease = (v: string): boolean => v.includes('-');

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!updaterEnabled) return null;
  try {
    const currentPrerelease = isPrerelease(CURRENT_VERSION);

    let latestTag: string;
    let htmlUrl: string;
    let body: string;
    let publishedAt: string;

    if (currentPrerelease) {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return null;
      const releases: any[] = await res.json();
      const prereleases = releases.filter((r: any) => r.prerelease === true);
      if (prereleases.length === 0) return null;

      prereleases.sort(
        (a: any, b: any) =>
          -compareFullSemver(
            String(a.tag_name).replace(/^v/, ''),
            String(b.tag_name).replace(/^v/, ''),
          ),
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

/** Resolve the real CDN URL for latest.json via the GitHub API (avoids CDN caching). */
async function resolveManifestUrl(tag: string): Promise<string> {
  const fallback = `https://github.com/${REPO}/releases/download/${tag}/latest.json`;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return fallback;
    const data: any = await res.json();
    const asset = (data.assets as any[]).find((a: any) => a.name === 'latest.json');
    return asset?.browser_download_url ?? fallback;
  } catch {
    return fallback;
  }
}

/** Resolve the Windows portable exe download URL via the GitHub API. */
async function resolveWindowsExeUrl(tag: string): Promise<string> {
  const version = tag.replace(/^v/, '');
  const fallback = `https://github.com/${REPO}/releases/download/${tag}/SUSUSongBoard-Windows-x64-${version}.exe`;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return fallback;
    const data: any = await res.json();
    const asset = (data.assets as any[]).find(
      (a: any) => a.name.startsWith('SUSUSongBoard-Windows') && a.name.endsWith('.exe'),
    );
    return asset?.browser_download_url ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Download and install the update for the given release tag.
 *
 * - macOS: fetches latest.json, uses tauri-plugin-updater (Ed25519 verified).
 * - Windows portable: downloads new .exe directly, queues a PowerShell self-replace
 *   script.  After this returns, call exitForUpdate() to trigger the replacement.
 *
 * Calls onProgress repeatedly during download.
 * Returns when the update is ready to apply.
 */
export async function installAppUpdate(
  tag: string,
  onProgress?: (p: DownloadProgress) => void,
  onDiag?: (e: DiagEntry) => void,
): Promise<void> {
  if (!updaterEnabled) throw new Error('自动更新未启用');
  const log = (msg: string) => {
    const e = diagEntry(msg);
    console.log(`[updater] ${e.ts} v${e.version}  ${msg}`);
    onDiag?.(e);
  };

  log(`开始更新  target=${tag}`);

  let unlisten: (() => void) | undefined;
  if (onProgress) {
    unlisten = await listen<DownloadProgress>('updater://progress', (event) => {
      onProgress(event.payload);
    });
  }

  try {
    if (isWindows()) {
      // Windows portable: download versioned exe to the same directory.
      log('Windows 便携模式，解析 exe 地址...');
      const exeUrl = await resolveWindowsExeUrl(tag);
      log(`exe URL: ${exeUrl}`);
      log('调用 install_portable_update...');
      await invoke('install_portable_update', { exeUrl });
      log('下载完成');
    } else {
      // macOS: tauri-plugin-updater downloads + extracts; caller shows restart button.
      log('正在解析 manifest 地址...');
      const manifestUrl = await resolveManifestUrl(tag);
      log(`manifest URL: ${manifestUrl}`);
      log('调用 install_app_update...');
      await invoke('install_app_update', { manifestUrl });
      log('install_app_update 返回成功');
    }
  } catch (e) {
    log(`更新失败: ${String(e)}`);
    throw e;
  } finally {
    unlisten?.();
  }
}

/** Restart the application to apply an installed update (macOS). */
export async function relaunchApp(): Promise<void> {
  await invoke('relaunch_app');
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
  const nA = preA !== undefined ? prereleaseNumber(preA) : -1;
  const nB = preB !== undefined ? prereleaseNumber(preB) : -1;
  return nA - nB;
}

/** Numeric order for prerelease suffixes; susu custom builds use `susu.<x>`. */
function prereleaseNumber(pre: string): number {
  const susu = /^susu\.(\d+)$/.exec(pre);
  if (susu) return Number(susu[1]);
  return parseInt(pre, 10) || 0;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
