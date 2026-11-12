/** What a platform plugin tells the app about itself.
 *
 *  The app only needs this much to list a platform and to decide which parts
 *  of the board it shows: every platform-specific call stays inside the
 *  platform's own module, which the app reaches through the registry. Adding
 *  one is a folder under `plugins/` plus a `registerPlatform` call — no edit
 *  to `Board.tsx`.
 */
export interface PlatformMeta {
  /** Stable id, stored in the config as `active_plugin`. Never rename it:
   *  an unknown id at startup falls back to "no platform". */
  id: string;
  /** Name in 设置 → 插件. */
  name: string;
  /** Short name for the status line and the sidebar (`酷狗`). */
  short: string;
  /** Version/state line under the name (`内置 v0.1.0`, `未接入`). */
  version: string;
  /** What the platform can do, under the version. */
  note: string;
  /** Whether playlists, auto-sync, song matching and 手动点歌 apply. A
   *  platform without it is selectable but shows none of those. */
  playlist: boolean;
}
