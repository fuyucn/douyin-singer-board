import { expect, open, test } from "nsh/test";
import { openSqliteBoard } from "./sqlite-test-options";

const config = JSON.stringify({
  room_id: "145997388006",
  sing_prefix: "点歌[space][song]",
  fans_level: 0,
  sing_cd: 0,
  cooldown_seconds: 0,
  max_songs_per_user: 3,
  target_playlist_name: "测试4",
  target_playlist_id: 27,
  kugou_enabled: true,
  blacklist: [],
  blacklist_singers: [],
  auto_sync: true,
  active_plugin: "kugou",
});

const session = JSON.stringify({ token: "TESTTOKEN", userid: "123456", dfid: "-" });

const searchBody = {
  data: {
    lists: [{
      SongName: "晴天",
      SingerName: "周杰伦",
      FileHash: "HASH1",
      AlbumID: "1",
      MixSongID: "2",
      Duration: 200,
    }],
  },
};

const playlistsBody = { data: { info: [{ name: "测试4", listid: 27, count: 0 }] } };

test("background worker moves a found song to played with one playlist write", async () => {
  let adds = 0;
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900,
    height: 700,
    clock: {},
    storage: { "board.config": config, "kugou.session": session },
    network: {
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: playlistsBody },
      "GET https://gateway.kugou.com/v2/search/song*": { body: searchBody },
      "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": () => {
        adds += 1;
        return { body: { status: 1 } };
      },
    },
  });
  // The platform runs in a WebView: page load is real time, the app clock is not.
  await new Promise((r) => setTimeout(r, 1800));
  // The plugin page loads on real time; the app clock is manual below.
  await new Promise((r) => setTimeout(r, 1600));
  await app.wait(200);
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(500);
  expect(app.texts()).toContain("点歌列表 (1)");
  await app.wait(6000);
  await new Promise((r) => setTimeout(r, 900));
  expect(app.texts()).toContain("已点歌单 (1)");
  expect(adds).toBe(1);
  await app.wait(10000);
  await new Promise((r) => setTimeout(r, 900));
  expect(adds).toBe(1);
});

test.skip("auth failure stops the worker instead of retrying a dead token", async () => {
  let adds = 0;
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900,
    height: 700,
    clock: {},
    storage: { "board.config": config, "kugou.session": session },
    network: {
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: playlistsBody },
      "GET https://gateway.kugou.com/v2/search/song*": { body: searchBody },
      "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": () => {
        adds += 1;
        return { body: { status: 0, error: "token expired" } };
      },
    },
  });
  // The platform runs in a WebView: page load is real time, the app clock is not.
  await new Promise((r) => setTimeout(r, 1800));
  // The plugin page loads on real time; the app clock is manual below.
  await new Promise((r) => setTimeout(r, 1600));
  await app.wait(200);
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(6000);
  await new Promise((r) => setTimeout(r, 900));
  expect(adds).toBe(1);
  await app.wait(60000);
  await new Promise((r) => setTimeout(r, 900));
  expect(adds).toBe(1);
});

test("a singer blacklist entry blocks syncing and marks the row", async () => {
  let adds = 0;
  const withBlacklist = { ...JSON.parse(config), blacklist_singers: ["周杰伦"] };
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900,
    height: 700,
    clock: {},
    storage: { "board.config": JSON.stringify(withBlacklist), "kugou.session": session },
    network: {
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: playlistsBody },
      "GET https://gateway.kugou.com/v2/search/song*": { body: searchBody },
      "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": () => {
        adds += 1;
        return { body: { status: 1 } };
      },
    },
  });
  // The platform runs in a WebView: page load is real time, the app clock is not.
  await new Promise((r) => setTimeout(r, 1800));
  // The plugin page loads on real time; the app clock is manual below.
  await new Promise((r) => setTimeout(r, 1600));
  await app.wait(200);
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(500);
  await app.wait(6000);
  await new Promise((r) => setTimeout(r, 900));
  expect(adds).toBe(0);
  expect(app.texts()).toContain("点歌列表 (1)");
  expect(app.texts()).toContain("黑名单 (歌手)");
});

test.skip("manual mark during an in-flight worker write adds only once", async () => {
  let adds = 0;
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900,
    height: 700,
    clock: {},
    storage: { "board.config": config, "kugou.session": session },
    network: {
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: playlistsBody },
      "GET https://gateway.kugou.com/v2/search/song*": { body: searchBody },
      "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": () => {
        adds += 1;
        return { body: { status: 1 }, delay: 1000 };
      },
    },
  });
  // The platform runs in a WebView: page load is real time, the app clock is not.
  await new Promise((r) => setTimeout(r, 1800));
  // The plugin page loads on real time; the app clock is manual below.
  await new Promise((r) => setTimeout(r, 1600));
  await app.wait(200);
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(2200);
  await new Promise((r) => setTimeout(r, 900));
  await app.press("id:song-add-0");
  await app.wait(4000);
  await new Promise((r) => setTimeout(r, 900));
  expect(app.texts()).toContain("已点歌单 (1)");
  expect(adds).toBe(1);
  await app.wait(10000);
  await new Promise((r) => setTimeout(r, 900));
  expect(adds).toBe(1);
});

test.skip("worker restart during an in-flight write does not replay it", async () => {
  let adds = 0;
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900,
    height: 700,
    clock: {},
    storage: { "board.config": config, "kugou.session": session },
    network: {
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: playlistsBody },
      "GET https://gateway.kugou.com/v2/search/song*": { body: searchBody },
      "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": () => {
        adds += 1;
        return { body: { status: 1 }, delay: 1500 };
      },
    },
  });
  // The platform runs in a WebView: page load is real time, the app clock is not.
  await new Promise((r) => setTimeout(r, 1800));
  // The plugin page loads on real time; the app clock is manual below.
  await new Promise((r) => setTimeout(r, 1600));
  await app.wait(200);
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(2100);
  await new Promise((r) => setTimeout(r, 900));
  expect(adds).toBe(1);
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-kugou");
  await app.press("id:plugin-kugou");
  await app.press("关闭");
  await app.wait(20000);
  await new Promise((r) => setTimeout(r, 900));
  expect(adds).toBe(1);
  // The late success must still move the row: otherwise the ledger says
  // "synced" forever and the song is stuck in the queue despite being in the
  // Kugou playlist.
  expect(app.texts()).toContain("已点歌单 (1)");
  expect(app.texts()).toContain("点歌列表 (0)");
});

test.skip("a transient search failure is retried and the song still syncs", async () => {
  let searches = 0;
  let adds = 0;
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900,
    height: 700,
    clock: {},
    storage: { "board.config": config, "kugou.session": session },
    network: {
      "POST https://gateway.kugou.com/v7/get_all_list*": { body: playlistsBody },
      "GET https://gateway.kugou.com/v2/search/song*": () => {
        searches += 1;
        return searches === 1 ? { error: "temporary network failure" } : { body: searchBody };
      },
      "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": () => {
        adds += 1;
        return { body: { status: 1 } };
      },
    },
  });
  // The platform runs in a WebView: page load is real time, the app clock is not.
  await new Promise((r) => setTimeout(r, 1800));
  // The plugin page loads on real time; the app clock is manual below.
  await new Promise((r) => setTimeout(r, 1600));
  await app.wait(200);
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.wait(12000);
  await new Promise((r) => setTimeout(r, 900));
  expect(searches).toBe(2);
  expect(adds).toBe(1);
  expect(app.texts()).toContain("已点歌单 (1)");
});
