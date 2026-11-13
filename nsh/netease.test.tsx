import { expect, test } from "nsh/test";
import { openSqliteBoard } from "./sqlite-test-options";

// NetEase runs as a plugin too: the app sends weapi posts to its channel, and
// this stubs the music.163.com answers (the encrypted body is opaque to a
// stub, the URL is not). `--target macos`: the channel needs a WebView.
test("netease: login restored, search, add to playlist", async () => {
  const cfg = JSON.stringify({
    room_id: "145997388006", sing_prefix: "点歌[space][song]", fans_level: 0,
    sing_cd: 0, cooldown_seconds: 1800, max_songs_per_user: 3,
    target_playlist_name: "测试4", target_playlist_id: 27, target_playlist_id_kind: "netease",
    blacklist: [], blacklist_singers: [], auto_sync: false,
    active_plugin: "netease-web", kugou_enabled: false, config_version: 2,
  });
  const session = JSON.stringify({ token: "MUSIC_U=TESTCOOKIE", userid: "123", dfid: "-", nickname: "测试用户" });
  const app = await openSqliteBoard("./Board.tsx", {
    width: 1000, height: 800,
    storage: { "board.config": cfg, "plugin.netease-web.session": session },
    network: {
      "POST https://music.163.com/weapi/w/nuser/account/get*": { body: { profile: { userId: 123, nickname: "测试用户" } } },
      "POST https://music.163.com/weapi/user/playlist*": { body: { playlist: [{ id: 27, name: "测试4", trackCount: 0 }] } },
      "POST https://music.163.com/weapi/cloudsearch/pc*": { body: { result: { songs: [{ id: 186016, name: "晴天", ar: [{ name: "周杰伦" }], dt: 269000 }] } } },
      "POST https://music.163.com/weapi/playlist/manipulate/tracks*": { body: { code: 200 } },
    },
  });
  await new Promise((r) => setTimeout(r, 1800));
  await app.wait(600);
  expect(app.texts().some((t: string) => t.includes("网易云服务就绪"))).toBe(true);

  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await new Promise((r) => setTimeout(r, 2500));
  await app.wait(500);
  expect(app.texts()).toContain("点歌列表 (1)");
  expect(app.texts().some((t: string) => t.includes("周杰伦"))).toBe(true);

  await app.press("id:song-add-0");
  await new Promise((r) => setTimeout(r, 1800));
  await app.wait(400);
  expect(app.texts()).toContain("已点歌单 (1)");
});

test("netease: cookie login from the plugin tab", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 1000, height: 800,
    storage: { "board.config": JSON.stringify({
      room_id: "", sing_prefix: "[song]", fans_level: 0, sing_cd: 0,
      cooldown_seconds: 1800, max_songs_per_user: 3, target_playlist_name: "测试4",
      target_playlist_id: 0, blacklist: [], blacklist_singers: [], auto_sync: false,
      active_plugin: "netease-web", kugou_enabled: false, config_version: 2,
    }) },
    network: {
      "POST https://music.163.com/weapi/w/nuser/account/get*": { body: { profile: { userId: 123, nickname: "测试用户" } } },
      "POST https://music.163.com/weapi/user/playlist*": { body: { playlist: [] } },
    },
  });
  await new Promise((r) => setTimeout(r, 2500));
  await app.wait(400);
  // The first press can land while the window is still becoming key; a second
  // one is what the suite does elsewhere too.
  await app.press("id:settings");
  await app.wait(800);
  if (!app.shows("id:settings-tab-plugin")) await app.press("id:settings");
  await app.wait(600);
  await app.press("id:settings-tab-plugin");
  await app.wait(600);
  await app.type("粘贴包含 MUSIC_U 的 Cookie", "MUSIC_U=TESTCOOKIE; os=pc");
  await app.press("id:ne-login");
  await app.wait(1200);
  expect(app.texts().some((t: string) => t.includes("已登录：测试用户"))).toBe(true);
});
