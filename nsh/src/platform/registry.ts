/** The platforms the app knows about.
 *
 *  Each platform module registers itself when it is imported, so this file
 *  stays free of platform names: `Board.tsx` imports the platform modules
 *  once and then asks the registry. That is what keeps a second platform out
 *  of the board's code.
 */
import type { PlatformMeta } from "./types";

const known = new Map<string, PlatformMeta>();

/** Called at import time by each platform module. */
export function registerPlatform(meta: PlatformMeta): void {
  known.set(meta.id, meta);
}

/** The platform of a config's `active_plugin`, or undefined for ``/unknown. */
export function platform(id: string | undefined): PlatformMeta | undefined {
  return id ? known.get(id) : undefined;
}

/** Every known platform, in registration order, for 设置 → 插件. */
export function platforms(): PlatformMeta[] {
  return [...known.values()];
}

/** Whether the app shows playlists, auto-sync and 手动点歌 for `id`. */
export function hasPlaylists(id: string | undefined): boolean {
  return platform(id)?.playlist === true;
}
