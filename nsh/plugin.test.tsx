import { expect, test } from "nsh/test";
import { openSqliteBoard } from "./sqlite-test-options";

// The whole path, through the real filesystem and a real web view: a plugin
// folder in `${dataDir}/plugins/demo/` (seeded here the way a user installs one)
// mounts a hidden WebView that runs its module, and the app calls it over the
// bridge. `--target macos`: fs and web views need a real platform.
const DEMO_MANIFEST = {
  id: "demo", name: "示例插件", version: "1.0.0", api: 1, entry: "index.js",
  note: "演示插件通道：log / storage / 方法调用",
  methods: ["hello", "search"],
};
const DEMO_SOURCE = `plugin.define({
  hello: async function () {
    var seen = await app.call("storage.get", { key: "runs" });
    await app.call("storage.set", { key: "runs", value: (seen || 0) + 1 });
    await app.call("log", { line: "示例插件第 " + ((seen || 0) + 1) + " 次被调用" });
    return { name: "示例插件", runs: (seen || 0) + 1 };
  },
  search: async function (params) {
    return [{ name: "示例 - " + params.q, artist: "示例歌手", key: "demo-1" }];
  }
});
`;

const demoSeed = [{
  manifest: DEMO_MANIFEST,
  files: { "index.js": DEMO_SOURCE },
}];

test("an installed plugin runs hidden and answers the app", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 1000, height: 800,
    host: { params: { pluginTestSeed: demoSeed, pluginDebug: true } },
  });

  await app.wait(1200);
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("示例插件");

  // Enable mounts the hidden web view and loads the page in it.
  await app.press("id:plugin-toggle-demo");
  await app.wait(1600);

  // The app calls the plugin. It answers, and the call it makes back into the
  // app's storage round-trips: the second call sees the first one's write.
  await app.press("id:plugin-hello-demo");
  await app.wait(900);
  const first = app.texts().find((t: string) => t.startsWith("hello →"));
  expect(first).toBeTruthy();
  expect(first).toContain('"runs":1');

  await app.press("id:plugin-hello-demo");
  await app.wait(900);
  const second = app.texts().find((t: string) => t.startsWith("hello →"));
  expect(second).toContain('"runs":2');

  // A list-returning method: the panel shows the first item the plugin made.
  await app.press("id:plugin-search-demo");
  await app.wait(900);
  expect(app.texts().join(" ")).toContain("示例 - 晴天");

  // Uninstall removes the folder: rescanning finds nothing left.
  await app.press("id:plugin-remove-demo");
  await app.wait(900);
  expect(app.texts().join(" ")).toContain("还没有其它插件");
});

test("calling a plugin that is not enabled says so instead of failing", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 1000, height: 800,
    host: { params: { pluginTestSeed: demoSeed, pluginDebug: true } },
  });
  await app.wait(1200);
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-hello-demo");
  await app.wait(600);
  expect(app.texts()).toContain("请先启用");
});
