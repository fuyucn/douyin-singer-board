import { expect, open, test } from "nsh/test";

test("settings modal opens on general", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.press("id:settings");
  expect(app.texts()).toContain("常规");
  expect(app.texts()).toContain("外观");
  expect(app.texts()).toContain("运行信息");
  expect(app.texts()).not.toContain("酷狗登录");
  await app.press("id:settings-close");
  expect(app.texts()).not.toContain("运行信息");
});

test("settings tabs switch between general, plugin and about", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("平台插件");
  expect(app.texts()).toContain("酷狗音乐");
  expect(app.texts()).not.toContain("运行信息");
  // The general-only appearance block must not leak into the plugin tab.
  expect(app.texts()).not.toContain("跟随系统");
  await app.press("id:settings-tab-general");
  expect(app.texts()).toContain("运行信息");
  await app.press("id:go-plugin");
  expect(app.texts()).toContain("平台插件");
  await app.press("id:settings-tab-about");
  expect(app.texts()).toContain("检查更新");
  expect(app.texts()).toContain("v0.8.1");
  await app.press("id:settings-close");
  expect(app.texts()).toContain("手动点歌");
});

test("platform plugin can be switched off and gates all playlist/song features", async () => {
  const cfg = JSON.stringify({
    room_id: "145997388006", sing_prefix: "点歌[space][song]", fans_level: 0,
    sing_cd: 0, cooldown_seconds: 1800, max_songs_per_user: 3,
    target_playlist_name: "测试4", target_playlist_id: 27,
    kugou_enabled: true, blacklist: [], blacklist_singers: [],
    auto_sync: false, active_plugin: "kugou", config_version: 2,
  });
  const sess = JSON.stringify({ token: "TESTTOKEN", userid: "123456", dfid: "-" });
  const app = await open("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": cfg, "kugou.session": sess },
    network: {
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: { status: 1, data: { info: [{ name: "测试4", listid: 27, count: 0 }] } } },
      "GET https://gateway.kugou.com/v2/search/song*": { body: { data: { lists: [] } } },
    },
  });
  await app.wait(200);
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(300);
  // Kugou selected: sidebar playlist block and the row's ListPlus are shown.
  expect(app.texts()).toContain("Kugou 歌单");
  expect(app.shows("id:song-add-0")).toBe(true);

  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-kugou");
  expect(app.texts().some((t: string) => t.includes("未选择平台：仅弹幕监听并收集点歌指令"))).toBe(true);
  expect(app.texts()).not.toContain("酷狗登录");
  await app.press("关闭");

  // Every playlist/song feature follows the platform selection.
  expect(app.texts()).not.toContain("Kugou 歌单");
  expect(app.texts()).not.toContain("酷狗服务就绪");
  expect(app.texts()).toContain("未启用平台插件");
  expect(app.shows("id:song-add-0")).toBe(false);
  expect(app.texts()).toContain("手动添加");

  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-kugou");
  expect(app.texts()).toContain("酷狗登录");
  await app.press("关闭");
  expect(app.texts()).toContain("Kugou 歌单");
});

test("blacklist accepts singer entries", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.press("黑名单 (0)");
  await app.press("id:black-type-singer");
  await app.type("输入歌手名…", "周杰伦");
  await app.press("id:black-add");
  expect(app.texts()).toContain("黑名单 (1)");
  expect(app.texts()).toContain("全部歌曲");
  await app.press("id:black-remove-0");
  expect(app.texts()).toContain("黑名单 (0)");
});

test("no platform = listener-only: no manual add, clear mode panel", async () => {
  const app = await open("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": JSON.stringify({ ...baseConfig, active_plugin: "", config_version: 2 }) },
  });
  await app.wait(200);
  const texts = app.texts();
  expect(texts).toContain("仅弹幕监听");
  expect(texts.some((t: string) => t.includes("点歌指令只进「点歌列表」"))).toBe(true);
  expect(texts).not.toContain("手动点歌");
  expect(texts).not.toContain("Kugou 歌单");
  expect(app.shows("text:输入歌曲名称...")).toBe(false);
  expect(texts).toContain("未启用平台插件");
  // Listener core is still enabled.
  expect(texts).toContain("直播间配置");
  expect(texts).toContain("点歌规则");
  expect(texts).toContain("点歌列表 (0)");

  // A listener-only blacklist must not promise Kugou artist matching.
  await app.press("黑名单 (0)");
  expect(app.texts().some((t: string) => t.includes("歌手名需在启用平台并匹配到酷狗歌曲后生效"))).toBe(true);
  expect(app.texts().some((t: string) => t.includes("歌手名屏蔽酷狗搜索到的所有歌曲"))).toBe(false);
  // Rule hints must not promise collection-side rate limiting.
  expect(app.texts().some((t: string) => t.includes("仅监听模式不限制重复指令"))).toBe(true);
  expect(app.texts().some((t: string) => t.includes("仅监听模式不启用该限制"))).toBe(true);

  await app.press("已点歌单 (0)");
  expect(app.texts().some((t: string) => t.includes("仅弹幕监听：启用平台并加入歌单后"))).toBe(true);
});

test("NetEase placeholder stays listener-only (no manual add)", async () => {
  const app = await open("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": JSON.stringify({ ...baseConfig, active_plugin: "netease", config_version: 2 }) },
  });
  await app.wait(200);
  expect(app.texts()).toContain("仅弹幕监听");
  expect(app.texts().some((t: string) => t.includes("网易云音乐未接入"))).toBe(true);
  expect(app.texts()).not.toContain("手动点歌");
  expect(app.shows("id:song-add-0")).toBe(false);
});

test("已点歌单 tab keeps its history when the platform is turned off", async () => {
  const cfg = JSON.stringify({
    ...baseConfig, target_playlist_name: "测试4", target_playlist_id: 27,
    active_plugin: "kugou", config_version: 2,
  });
  const sess = JSON.stringify({ token: "TESTTOKEN", userid: "123456", dfid: "-" });
  const app = await open("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": cfg, "kugou.session": sess },
    network: {
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: { status: 1, data: { info: [{ name: "测试4", listid: 27, count: 0 }] } } },
      "GET https://gateway.kugou.com/v2/search/song*": { body: { data: { lists: [{ SongName: "晴天", SingerName: "周杰伦", FileHash: "HASH1", AlbumID: "1", MixSongID: "2", Duration: 200 }] } } },
      "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": { body: { status: 1 } },
    },
  });
  await app.wait(200);
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(300);
  await app.press("id:song-add-0");
  await app.wait(600);
  expect(app.texts()).toContain("已点歌单 (1)");

  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-kugou");
  await app.press("关闭");
  expect(app.texts()).toContain("已点歌单 (1)");
  await app.press("已点歌单 (1)");
  expect(app.texts()).toContain("晴天");
});

test("no Kugou session means no search request at all", async () => {
  // The original's useKugouSearch returns early without kugouLoggedIn.
  const cfg = JSON.stringify({
    ...baseConfig, target_playlist_name: "测试4", target_playlist_id: 27,
    active_plugin: "kugou", config_version: 2,
  });
  const app = await open("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": cfg },
    network: {
      "GET https://gateway.kugou.com/v2/search/song*": { body: { data: { lists: [] } } },
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: { status: 1, data: { info: [] } } },
    },
  });
  await app.wait(200);
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(500);
  const urls = app.requests().map((r: any) => String(r.url ?? r));
  expect(urls.some((u: string) => u.includes("/v2/search/song"))).toBe(false);
  expect(app.texts().some((t: string) => t.includes("酷狗搜索中"))).toBe(false);
  expect(app.texts()).toContain("酷狗未登录");
  // ListPlus and the platform playlist block are both gated on the session.
  expect(app.shows("id:song-add-0")).toBe(false);
  expect(app.texts()).not.toContain("Kugou 歌单");
});

const baseConfig = {
  room_id: "145997388006",
  sing_prefix: "点歌[space][song]",
  fans_level: 0,
  sing_cd: 0,
  cooldown_seconds: 1800,
  max_songs_per_user: 3,
  target_playlist_name: "",
  target_playlist_id: 0,
  blacklist: [],
  auto_sync: false,
  active_plugin: "kugou",
};

test("0.5.x configs are upgraded with Kugou selected", async () => {
  const app = await open("./Board.tsx", {
    width: 900,
    height: 700,
    storage: { "board.config": JSON.stringify({ ...baseConfig, kugou_enabled: false }) },
  });
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("酷狗登录");
  await app.press("id:plugin-kugou");
  expect(app.texts().some((t: string) => t.includes("未选择平台：仅弹幕监听并收集点歌指令"))).toBe(true);
});

test("a v2 config with the service explicitly disabled selects no platform", async () => {
  const app = await open("./Board.tsx", {
    width: 900,
    height: 700,
    storage: {
      "board.config": JSON.stringify({ ...baseConfig, kugou_enabled: false, config_version: 2, active_plugin: undefined }),
    },
  });
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).not.toContain("酷狗登录");
  expect(app.texts().some((t: string) => t.includes("未选择平台：仅弹幕监听并收集点歌指令"))).toBe(true);
});
