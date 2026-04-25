// KuGou search integration.
// Phase 1: try the kugou:// URL scheme (PC client). If the scheme is not
// registered (no client, or it failed to open), fall back to the web search.

import { open } from '@tauri-apps/plugin-shell';

export async function openKuGouSearch(keyword: string): Promise<void> {
  const k = keyword.trim();
  if (!k) return;
  const enc = encodeURIComponent(k);
  const scheme = `kugou://search?keyword=${enc}`;
  const web = `https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=${enc}`;
  try {
    await open(scheme);
  } catch {
    await open(web);
  }
}
