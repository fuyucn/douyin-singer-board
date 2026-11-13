import { expect, test } from "nsh/test";
import { openSqliteBoard } from "./sqlite-test-options";
import { openSqliteBoard as open } from "./sqlite-test-options";

const loggedConfig = JSON.stringify({
  room_id: "145997388006",
  sing_prefix: "点歌[space][song]",
  fans_level: 0,
  sing_cd: 0,
  cooldown_seconds: 1800,
  max_songs_per_user: 3,
  target_playlist_name: "测试4",
  target_playlist_id: 27,
  kugou_enabled: true,
  blacklist: [],
  blacklist_singers: [],
  auto_sync: false,
  active_plugin: "kugou",
  config_version: 2,
});
const session = JSON.stringify({ token: "TESTTOKEN", userid: "123456", dfid: "-" });
const network = {
  "POST https://gateway.kugou.com/v7/get_all_list*": { body: { data: { info: [{ name: "测试4", listid: 27, count: 0 }] } } },
  "GET https://gateway.kugou.com/v2/search/song*": { body: { data: { lists: [{ SongName: "晴天", SingerName: "周杰伦", FileHash: "HASH1", AlbumID: "1", MixSongID: "2", Duration: 200 }] } } },
  "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": { body: { status: 1 } },
};

test("board shell, manual request, tabs and plugin settings", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": loggedConfig, "kugou.session": session },
    network,
  });
  await new Promise((r) => setTimeout(r, 800));
  expect(app.texts()).toContain("SUSUSongBoard");
  expect(app.texts()).toContain("抖音直播间 ID");
  expect(app.texts()).toContain("点歌列表 (0)");

  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  expect(app.texts()).toContain("晴天");
  expect(app.texts()).toContain("点歌列表 (1)");

  await app.wait(300);
  await app.press("id:song-add-0");
  await new Promise((r) => setTimeout(r, 1600));
  await app.wait(500);
  expect(app.texts()).toContain("已点歌单 (1)");
  expect(app.texts()).toContain("点歌列表 (0)");

  await app.press("id:settings");
  expect(app.texts()).toContain("常规");
  expect(app.texts()).toContain("外观");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("可选一个平台，也可以都不开；歌单、自动同步与歌曲匹配只随所选平台显示。");
  expect(app.texts()).toContain("酷狗音乐");
  expect(app.texts()).toContain("网易云音乐");
  expect(app.texts()).toContain("可选一个平台，也可以都不开；歌单、自动同步与歌曲匹配只随所选平台显示。");
  expect(app.texts()).toContain("网易云音乐");
  expect(app.texts().some((t: string) => t.includes("扫码登录"))).toBe(true);
  // Turning the platform off hides its login block; turning it back on shows it.
  await app.press("id:plugin-kugou");
  expect(app.texts()).not.toContain("酷狗登录");
  await app.press("id:plugin-kugou");
  expect(app.texts()).toContain("酷狗登录");
  await app.press("关闭");
  expect(app.texts()).toContain("手动点歌");

  await app.press("黑名单 (0)");
  expect(app.texts()).toContain("黑名单为空");
  await app.type("输入歌曲名…", "晴天");
  await app.press("id:black-add");
  expect(app.texts()).toContain("黑名单 (1)");
  await app.press("id:black-remove-0");
  expect(app.texts()).toContain("黑名单 (0)");
});
