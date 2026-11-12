import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from "fs/promises";
import { BRIDGE_API, type InstalledPlugin, type PluginManifest } from "./types";

/** Where plugins live: one folder each, under the app's data directory. */
export function pluginsDir(dataDir: string): string {
  return `${dataDir}/plugins`;
}

/** A plugin id is a folder name: it may not reach outside the plugins folder. */
export function validPluginId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(id);
}

/** Every plugin installed under `dir`, skipping what is not readable: a plugin
 *  the app cannot read is reported, not fatal. */
export async function listPlugins(dataDir: string): Promise<InstalledPlugin[]> {
  const dir = pluginsDir(dataDir);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const found: InstalledPlugin[] = [];
  for (const name of names) {
    if (!validPluginId(name)) continue;
    try {
      const raw = await readFile(`${dir}/${name}/plugin.json`, "utf8");
      const manifest = JSON.parse(raw) as PluginManifest;
      if (manifest?.id !== name || typeof manifest.entry !== "string") continue;
      const source = await readFile(`${dir}/${name}/${manifest.entry}`, "utf8");
      const api = Number(manifest.api ?? 0);
      found.push({
        manifest,
        dir: `${dir}/${name}`,
        source,
        blocked: api > BRIDGE_API ? `需要 api ${api}，当前应用支持 api ${BRIDGE_API}` : undefined,
      });
    } catch {
      /* an incomplete or unreadable plugin folder is skipped */
    }
  }
  return found;
}

/** Writes a plugin folder: what "安装示例插件" and an install from a file do. */
export async function installPlugin(
  dataDir: string,
  manifest: PluginManifest,
  files: Record<string, string>,
): Promise<InstalledPlugin> {
  if (!validPluginId(manifest.id)) throw new Error(`插件 id 不合法: ${manifest.id}`);
  const dir = `${pluginsDir(dataDir)}/${manifest.id}`;
  await mkdir(dir, { recursive: true });
  // Manifest last: a half-written upgrade keeps the old version on disk, so
  // the next launch tries again instead of believing it is already current.
  for (const [name, text] of Object.entries(files)) {
    await writeFile(`${dir}/${name}`, text);
  }
  await writeFile(`${dir}/plugin.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, dir, source: files[manifest.entry] ?? "" };
}

/** Removes a plugin folder. The app never keeps what it uninstalled. */
export async function removePlugin(dataDir: string, id: string): Promise<void> {
  if (!validPluginId(id)) throw new Error(`插件 id 不合法: ${id}`);
  const dir = `${pluginsDir(dataDir)}/${id}`;
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    try {
      await unlink(`${dir}/${name}`);
    } catch {
      /* a file the plugin left behind that is not a file */
    }
  }
  await rmdir(dir);
}
