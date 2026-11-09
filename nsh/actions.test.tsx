import { expect, open, test } from "nsh/test";

const add = async (app: any, name: string) => {
  await app.type("输入歌曲名称...", name);
  await app.press("添加");
};

test("row copy writes the clipboard and shows visible feedback", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700, clipboard: "INITIAL" });
  await add(app, "晴天");
  await app.press("id:toolbar-copy");
  expect(app.clipboard()).toBe("晴天");
  expect(app.texts().some((t: string) => t.includes("已复制"))).toBe(true);
});

test("delete removes the row itself, not just the counter", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await add(app, "晴天");
  await add(app, "起风了");
  expect(app.texts()).toContain("点歌列表 (2)");
  await app.press("id:toolbar-delete");
  expect(app.texts()).toContain("点歌列表 (1)");
  expect(app.texts()).not.toContain("起风了");
  expect(app.texts()).toContain("晴天");
});

test("mark played, played-copy and the search clear button", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700, clipboard: "INITIAL" });
  await add(app, "晴天");
  await app.press("id:toolbar-mark");
  expect(app.texts()).toContain("已点歌单 (1)");
  await app.press("已点歌单 (1)");
  await app.press("id:played-toolbar-copy");
  expect(app.clipboard()).toBe("晴天");
  await app.type("搜索歌曲名或用户…", "晴");
  await app.press("id:played-clear-query");
  expect(app.texts()).toContain("晴天");
});

test("clear list asks for confirmation and resets the played search", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await add(app, "晴天");
  await add(app, "起风了");
  await app.press("id:clear-list");
  expect(app.texts()).toContain("确认清空");
  expect(app.texts()).toContain("点歌列表 (2)");
  await app.press("id:clear-list");
  expect(app.texts()).toContain("点歌列表 (0)");
  expect(app.texts()).toContain("当前点歌列表为空");

  // Clearing played must not leave a stale search filter behind.
  await add(app, "后来");
  await app.press("id:toolbar-mark");
  await app.press("已点歌单 (1)");
  await app.type("搜索歌曲名或用户…", "后");
  await app.press("id:clear-list");
  await app.press("id:clear-list");
  expect(app.texts()).toContain("暂无已点歌曲");
  await app.press("点歌列表 (0)");
  await add(app, "新歌");
  await app.press("id:toolbar-mark");
  await app.press("已点歌单 (1)");
  expect(app.texts()).toContain("新歌");
  expect(app.texts()).not.toContain("没有匹配的歌曲");
});

test("log copy does not lie about its own success", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700, clipboard: "INITIAL" });
  await add(app, "晴天");
  await app.press("id:log-copy");
  const clip = String(app.clipboard());
  expect(clip.length).toBeGreaterThan(0);
  expect(clip).toContain("晴天");
  expect(clip).not.toContain("日志已复制");
  await app.press("id:log-clear");
  expect(app.texts()).not.toContain("日志");
});

test("blacklist add/remove and log chevron still respond", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.press("黑名单 (0)");
  await app.type("输入歌曲名…", "坏歌");
  await app.press("id:black-add");
  expect(app.texts()).toContain("黑名单 (1)");
  await app.press("id:black-remove-0");
  expect(app.texts()).toContain("黑名单 (0)");
  await add(app, "晴天");
  await app.press("id:log-chevron");
  expect(app.texts().some((t: string) => t.includes("复制"))).toBe(true);
});

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
const searchBody = {
  data: { lists: [{ SongName: "晴天", SingerName: "周杰伦", FileHash: "HASH1", AlbumID: "1", MixSongID: "2", Duration: 200 }] },
};
const playlistsBody = { data: { info: [{ name: "测试4", listid: 27, count: 0 }] } };
const kugouNetwork = {
  "POST https://gateway.kugou.com/v7/get_all_list*": { body: playlistsBody },
  "GET https://gateway.kugou.com/v2/search/song*": { body: searchBody },
};

test("settings plugin actions give feedback and join-to-board adds a row", async () => {
  const app = await open("./Board.tsx", {
    width: 900,
    height: 700,
    storage: { "board.config": loggedConfig, "kugou.session": session },
    network: kugouNetwork,
  });
  await app.wait(200);
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");

  await app.press("搜索");
  expect(app.texts().some((t: string) => t.includes("请先输入歌名"))).toBe(true);

  await app.type("搜索酷狗歌曲", "晴天");
  await app.press("搜索");
  await app.wait(200);
  await app.press("加入列表");
  expect(app.texts().some((t: string) => t.includes("已加入点歌列表"))).toBe(true);
  await app.press("id:settings-close");
  expect(app.texts()).toContain("点歌列表 (1)");
  expect(app.texts()).toContain("晴天");
});

test("about check-update and theme buttons respond", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.press("id:theme");
  await app.press("id:settings");
  await app.press("id:settings-tab-about");
  await app.press("id:about-update");
  await app.wait(100);
  expect(app.texts().some((t: string) => t.includes("最新") || t.includes("更新源") || t.includes("正在检查"))).toBe(true);
  await app.press("id:settings-close");
  expect(app.texts()).toContain("手动点歌");
});
