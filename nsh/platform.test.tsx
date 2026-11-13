import { expect, test } from "nsh/test";
import { openSqliteBoard } from "./sqlite-test-options";

// The config's `active_plugin` is the only place a platform is remembered, so
// what the board does with an id it does not know is what decides whether a
// platform module can be added or removed at all: an unknown id must not
// become "kugou" behind the user's back.

const cfg = (extra: Record<string, unknown>) =>
  JSON.stringify({
    room_id: "145997388006", sing_prefix: "点歌[space][song]", fans_level: 0,
    sing_cd: 0, cooldown_seconds: 1800, max_songs_per_user: 3,
    target_playlist_name: "测试4", target_playlist_id: 27,
    blacklist: [], blacklist_singers: [], auto_sync: false, config_version: 2,
    ...extra,
  });

const kugouUi = (texts: string[]) =>
  texts.some((t) => t === "酷狗 歌单" || t === "酷狗未登录" || t === "酷狗服务就绪");

test("a registered platform other than kugou is kept, with no kugou UI", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": cfg({ active_plugin: "netease", kugou_enabled: false }) },
  });
  await app.wait(200);
  expect(kugouUi(app.texts())).toBe(false);
  expect(app.shows("id:song-add-0")).toBe(false);
  // The picker still lists it as the selected platform.
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("网易云音乐");
});

test("an id whose platform is not installed is kept, not rewritten to kugou", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": cfg({ active_plugin: "acme-music", kugou_enabled: false }) },
  });
  await app.wait(200);
  expect(kugouUi(app.texts())).toBe(false);
  expect(app.texts()).not.toContain("酷狗登录");
});

test("a config without active_plugin still upgrades to kugou when it was on", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": cfg({ kugou_enabled: true, config_version: 2 }) },
  });
  await app.wait(200);
  // 酷狗未登录 is the kugou-only footer state: the upgrade picked kugou.
  expect(app.texts()).toContain("酷狗未登录");
});

test("a config without active_plugin and the service off selects nothing", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": cfg({ kugou_enabled: false, config_version: 2 }) },
  });
  await app.wait(200);
  expect(kugouUi(app.texts())).toBe(false);
  expect(app.texts()).toContain("仅弹幕监听");
});
