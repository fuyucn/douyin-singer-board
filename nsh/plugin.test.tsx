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
    host: { params: { pluginTestSeed: demoSeed } },
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
    host: { params: { pluginTestSeed: demoSeed } },
  });
  await app.wait(1200);
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-hello-demo");
  await app.wait(600);
  expect(app.texts()).toContain("请先启用");
});

test("the kugou plugin searches and adds through the channel", async () => {
  const config = JSON.stringify({
    room_id: "145997388006", sing_prefix: "点歌[space][song]", fans_level: 0,
    sing_cd: 0, cooldown_seconds: 1800, max_songs_per_user: 3,
    target_playlist_name: "测试4", target_playlist_id: 27,
    kugou_enabled: true, blacklist: [], blacklist_singers: [],
    auto_sync: false, active_plugin: "kugou", config_version: 2,
  });
  const session = JSON.stringify({ token: "TESTTOKEN", userid: "123456", dfid: "-" });
  const app = await openSqliteBoard("./Board.tsx", {
    width: 1000, height: 800,
    storage: { "board.config": config, "plugin.kugou-web.session": session },
    network: {
      "GET https://gateway.kugou.com/v2/search/song*": {
        body: { data: { lists: [{ SongName: "晴天", SingerName: "周杰伦", FileHash: "H1", AlbumID: 1, MixSongID: 2, Duration: 1 }] } },
      },
      "POST https://gateway.kugou.com/v7/get_all_list*": {
        body: { status: 1, data: { info: [{ name: "测试4", listid: 27, count: 0 }] } },
      },
      "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": { body: { status: 1 } },
    },
  });

  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  if (app.shows("id:kw-install")) await app.press("id:kw-install");
  await app.wait(900);
  // The seeded config already selects the platform; pressing would turn it off.
  if (app.texts().includes("启用")) await app.press("id:plugin-kugou");
  await app.wait(1800);

  await app.type("搜索歌名", "晴天");
  await app.press("id:kw-search");
  await app.wait(1200);
  expect(app.texts().join(" ")).toContain("周杰伦 - 晴天");

  await app.press("id:kw-add");
  await app.wait(1500);
  expect(app.texts().join(" ")).toContain("已加入：晴天");
}, 90000);
