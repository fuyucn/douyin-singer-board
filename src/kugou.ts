// KuGou client integration. Flow:
//   1) call Rust `kugou_search` to hit KuGou's public search API server-side
//      (avoids browser CORS + lets us cache the response shape in one place)
//   2) take the top hit and shape it into the `{Files:[{...}]}` JSON the PC
//      client's deep link expects, base64-encode it, and open
//      `kugou://play?p=<b64>` (Mac client uses `mackugou://`).

import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';

export interface KuGouSong {
  filename: string;
  hash: string;
  size: string;
  duration: string;
  bitrate: string;
  isfilehead: string;
  privilege: string;
  album_id: string;
}

const isMac = navigator.userAgent.toUpperCase().includes('MAC');
const SCHEME = isMac ? 'mackugou' : 'kugou';

export async function searchKuGou(keyword: string): Promise<KuGouSong | null> {
  return invoke<KuGouSong | null>('kugou_search', { keyword });
}

// btoa() rejects non-Latin1; route through UTF-8 first so Chinese filenames
// survive the base64 round-trip.
function utf8Btoa(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function playKuGouSong(song: KuGouSong): Promise<void> {
  const json = JSON.stringify({ Files: [song] });
  const b64 = utf8Btoa(json);
  const url = `${SCHEME}://play?p=${b64}`;
  await open(url);
}
