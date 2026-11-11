import { expect, test } from "nsh/test";
import { openSqliteBoard as open } from "./sqlite-test-options";

// These run with `nsh test table-actions-target.test.tsx --target macos`.
// Headless tests call onPress directly and looked green while the real
// renderer ignored buttons inside DataTable cells. Row buttons must be real
// pressable views, so keep this suite on a real renderer.
test("row buttons work on a real renderer", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700, clipboard: "INITIAL" });
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.type("输入歌曲名称...", "起风了");
  await app.press("添加");
  await app.press("id:song-copy-0");
  expect(app.clipboard()).toBe("起风了");
  expect(app.texts().some((t: string) => t.includes("已复制"))).toBe(true);
  await app.press("id:song-del-0");
  expect(app.texts()).toContain("点歌列表 (1)");
  expect(app.texts()).toContain("晴天");
  expect(app.texts()).not.toContain("起风了");
});

test("a non-first row's buttons act on that row", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  for (const name of ["第一首", "第二首", "第三首"]) {
    await app.type("输入歌曲名称...", name);
    await app.press("添加");
  }
  // Songs are prepended: index 0 = 第三首, 1 = 第二首, 2 = 第一首.
  await app.press("id:song-del-2");
  expect(app.texts()).toContain("点歌列表 (2)");
  expect(app.texts()).not.toContain("第一首");
  expect(app.texts()).toContain("第三首");
  expect(app.texts().some((t: string) => t.includes("已删除：第一首"))).toBe(true);
});

test("right-click on the song cell opens the original context menu", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.rightClick("text:晴天");
  const items: any[] = app.menu() ?? [];
  expect(items.some((i) => i.label === "复制弹幕" && !i.disabled)).toBe(true);
  expect(items.some((i) => i.label === "删除" && !i.disabled)).toBe(true);
});

const loggedConfig = JSON.stringify({
  room_id: "145997388006", sing_prefix: "点歌[space][song]", fans_level: 0,
  sing_cd: 0, cooldown_seconds: 1800, max_songs_per_user: 3,
  target_playlist_name: "测试4", target_playlist_id: 27, kugou_enabled: true,
  blacklist: [], blacklist_singers: [], auto_sync: false,
  active_plugin: "kugou", config_version: 2,
});
const session = JSON.stringify({ token: "TESTTOKEN", userid: "123456", dfid: "-" });
const network = {
  "POST https://gateway.kugou.com/v7/get_all_list*": { body: { data: { info: [{ name: "测试4", listid: 27, count: 0 }] } } },
  "GET https://gateway.kugou.com/v2/search/song*": { body: { data: { lists: [{ SongName: "晴天", SingerName: "周杰伦", FileHash: "HASH1", AlbumID: "1", MixSongID: "2", Duration: 200 }] } } },
  "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": { body: { status: 1 } },
};

test("ListPlus is pressable on a real renderer and moves the row", async () => {
  const app = await open("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": loggedConfig, "kugou.session": session },
    network,
  });
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(600);
  await app.press("id:song-add-0");
  await app.wait(800);
  expect(app.texts()).toContain("已点歌单 (1)");
  expect(app.texts()).toContain("点歌列表 (0)");
});

test("listener-only mode renders on a real renderer", async () => {
  const cfg = JSON.stringify({
    room_id: "145997388006", sing_prefix: "点歌[space][song]", fans_level: 0,
    sing_cd: 0, cooldown_seconds: 1800, max_songs_per_user: 3,
    target_playlist_name: "测试4", target_playlist_id: 27, kugou_enabled: false,
    blacklist: [], blacklist_singers: [], auto_sync: false,
    active_plugin: "", config_version: 2,
  });
  const app = await open("./Board.tsx", { width: 900, height: 700, storage: { "board.config": cfg } });
  await app.wait(400);
  expect(app.texts()).toContain("仅弹幕监听");
  expect(app.texts()).toContain("直播间配置");
  expect(app.texts()).toContain("点歌列表 (0)");
  expect(app.texts()).not.toContain("手动点歌");
  expect(app.texts()).toContain("未启用平台插件");
  // The version footer must stay visible with the mode panel in place.
  expect(app.texts().some((t: string) => t.includes("SUSUSongBoard v"))).toBe(true);
});

test("auto-sync toggle is pressable on a real renderer and resolves the playlist", async () => {
  const app = await open("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": loggedConfig, "kugou.session": session },
    network: {
      ...network,
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: { data: { info: [{ name: "测试4", listid: 27, count: 0 }] } } },
    },
  });
  await app.wait(500);
  await app.press("id:auto-sync");
  await app.wait(600);
  expect(app.texts()).toContain("同步中");
  expect(app.texts()).toContain("id: 27");
});
