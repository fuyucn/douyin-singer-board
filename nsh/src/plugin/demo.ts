import type { PluginManifest } from "./types";

/** The example plugin the app ships: what "安装示例插件" writes into
 *  `${dataDir}/plugins/demo/`, and what `plugin.test.tsx` runs through the
 *  bridge. It makes no network calls, so the whole path is testable offline. */
export const DEMO_PLUGIN: PluginManifest = {
  id: "demo",
  name: "示例插件",
  version: "1.0.0",
  api: 1,
  entry: "index.js",
  note: "演示插件通道：log / storage / 方法调用",
  methods: ["hello", "search", "fetchDemo"],
};

export const DEMO_SOURCE = `// A plugin sees two globals: app.call(method, params) and plugin.define({...}).
plugin.define({
  hello: async function () {
    var seen = await app.call("storage.get", { key: "runs" });
    await app.call("storage.set", { key: "runs", value: (seen || 0) + 1 });
    await app.call("log", { line: "示例插件第 " + ((seen || 0) + 1) + " 次被调用" });
    return { name: "示例插件", runs: (seen || 0) + 1 };
  },
  // What a real platform plugin answers with: the app asks, the plugin decides
  // how to get the answer (its own fetch, its own signing).
  search: async function (params) {
    await app.call("log", { line: "示例插件搜索: " + params.q });
    return [
      { name: "示例 - " + params.q, artist: "示例歌手", key: "demo-1" },
      { name: "示例 - 另一首", artist: "示例歌手", key: "demo-2" }
    ];
  },
  // Proves the app's own network path: the request goes through the app's
  // fetch, so capabilities and the app's headers still apply.
  fetchDemo: async function (params) {
    var body = await app.call("http.json", { url: params.url });
    return { note: body && body.note };
  }
});
`;
