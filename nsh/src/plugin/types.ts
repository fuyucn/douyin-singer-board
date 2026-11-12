/** What a plugin folder's `plugin.json` declares.
 *
 *  A plugin is a folder in `${dataDir}/plugins/<id>/` with that file and one
 *  JavaScript module. The app runs the module in a web view of its own (the
 *  only way an NSH app may run code it did not compile) and talks to it over
 *  the bridge; see `bridge.ts` and `page.ts`. */
export interface PluginManifest {
  /** Folder name; `[a-z0-9-]`. What the app calls the plugin by. */
  id: string;
  name: string;
  version: string;
  /** The bridge API version the plugin was written for. */
  api: number;
  /** One line under the name in 设置 → 插件. */
  note?: string;
  /** The module the app loads, relative to the folder. */
  entry: string;
  /** The methods it answers, for the panel. */
  methods?: string[];
}

/** A plugin the app found on disk, with what it declared and its source. */
export interface InstalledPlugin {
  manifest: PluginManifest;
  dir: string;
  source: string;
  /** Why the app cannot run it (a newer bridge than this app speaks), or
   *  undefined when it can. A plugin that does not fit is still listed: after
   *  an app update the folder is still there, and a plugin that vanished from
   *  the list would look like the app deleted it. */
  blocked?: string;
}

/** What the bridge API version this app speaks is. */
export const BRIDGE_API = 1;
