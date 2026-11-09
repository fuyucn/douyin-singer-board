import { expect, open, test } from "nsh/test";

test("settings modal opens on general and the info button jumps to about", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.press("id:settings");
  expect(app.texts()).toContain("常规");
  expect(app.texts()).toContain("外观");
  expect(app.texts()).toContain("运行信息");
  expect(app.texts()).not.toContain("管理酷狗音乐");
  await app.press("id:settings-close");

  await app.press("id:about");
  const texts = app.texts();
  expect(texts).toContain("SUSUSongBoard");
  expect(texts).toContain("v0.7.0 · NSH 原生版");
  expect(texts).toContain("仓库：fuyucn/douyin-singer-board · 分支 nsh");
  expect(texts).toContain("检查更新");
  expect(texts).not.toContain("平台插件");
  await app.press("id:settings-close");
  expect(app.texts()).not.toContain("检查更新");
});

test("settings tabs switch between general, plugin and about", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("平台插件");
  expect(app.texts()).toContain("启用酷狗服务");
  expect(app.texts()).not.toContain("运行信息");
  // The general-only appearance block must not leak into the plugin tab.
  expect(app.texts()).not.toContain("跟随系统");
  await app.press("id:settings-tab-general");
  expect(app.texts()).toContain("运行信息");
  await app.press("id:go-plugin");
  expect(app.texts()).toContain("平台插件");
  await app.press("id:settings-tab-about");
  expect(app.texts()).toContain("检查更新");
  await app.press("id:settings-close");
  expect(app.texts()).toContain("手动点歌");
});

test("blacklist accepts singer entries and the service toggle gates settings", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.press("黑名单 (0)");
  await app.press("id:black-type-singer");
  await app.type("输入歌手名…", "周杰伦");
  await app.press("id:black-add");
  expect(app.texts()).toContain("黑名单 (1)");
  expect(app.texts()).toContain("全部歌曲");
  await app.press("id:black-remove-0");
  expect(app.texts()).toContain("黑名单 (0)");

  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("启用酷狗服务");
  await app.press("id:kugou-toggle");
  expect(app.texts()).toContain("酷狗服务已停用，上方开关可重新启用。");
  expect(app.texts()).not.toContain("管理酷狗音乐");
  await app.press("id:kugou-toggle");
  expect(app.texts()).toContain("管理酷狗音乐");
  await app.press("关闭");
  expect(app.texts()).toContain("手动点歌");
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

test("0.5.x configs are upgraded with Kugou enabled", async () => {
  const app = await open("./Board.tsx", {
    width: 900,
    height: 700,
    storage: { "board.config": JSON.stringify({ ...baseConfig, kugou_enabled: false }) },
  });
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("管理酷狗音乐");
  await app.press("id:kugou-toggle");
  expect(app.texts()).toContain("酷狗服务已停用，上方开关可重新启用。");
});

test("a v2 config respects an explicitly disabled Kugou service", async () => {
  const app = await open("./Board.tsx", {
    width: 900,
    height: 700,
    storage: {
      "board.config": JSON.stringify({ ...baseConfig, kugou_enabled: false, config_version: 2 }),
    },
  });
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).not.toContain("管理酷狗音乐");
  expect(app.texts()).toContain("酷狗服务已停用，上方开关可重新启用。");
});
