import { expect, open, test } from "nsh/test";
import { openSqliteBoard } from "./sqlite-test-options";

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
  "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": { body: { status: 1 } },
};

const loggedOptions = (extra: Record<string, unknown> = {}) => ({
  width: 900,
  height: 700,
  storage: { "board.config": loggedConfig, "kugou.session": session },
  network: kugouNetwork,
  ...extra,
});

const add = async (app: any, name: string) => {
  await app.type("输入歌曲名称...", name);
  await app.press("添加");
};

/** The row's ListPlus button: one transaction, addTrack must succeed before
 *  the row moves to 已点. Requires a logged-in config and network stubs. */
const addToPlayed = async (app: any, name: string) => {
  await add(app, name);
  await app.wait(300);
  await app.press("id:song-add-0");
  await app.wait(500);
};

test("row copy writes the clipboard and shows visible feedback", async () => {
  const app = await openSqliteBoard("./Board.tsx", { width: 900, height: 700, clipboard: "INITIAL" });
  await add(app, "晴天");
  await app.press("id:song-copy-0");
  expect(app.clipboard()).toBe("晴天");
  expect(app.texts().some((t: string) => t.includes("已复制"))).toBe(true);
});

test("delete removes the row itself, not just the counter", async () => {
  const app = await openSqliteBoard("./Board.tsx", { width: 900, height: 700 });
  await add(app, "晴天");
  await add(app, "起风了");
  expect(app.texts()).toContain("点歌列表 (2)");
  await app.press("id:song-del-0");
  expect(app.texts()).toContain("点歌列表 (1)");
  expect(app.texts()).not.toContain("起风了");
  expect(app.texts()).toContain("晴天");
});

test("add-to-playlist, played-copy and the search clear button", async () => {
  const app = await openSqliteBoard("./Board.tsx", loggedOptions({ clipboard: "INITIAL" }));
  await addToPlayed(app, "晴天");
  expect(app.texts()).toContain("已点歌单 (1)");
  await app.press("已点歌单 (1)");
  await app.press("id:played-copy-0");
  expect(app.clipboard()).toBe("晴天");
  await app.type("搜索歌曲名或用户…", "晴");
  await app.press("id:played-clear-query");
  expect(app.texts()).toContain("晴天");
});

test("clear playlist recreates it and updates the target id", async () => {
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": { body: { status: 1, data: { info: { listid: 42 } } } } as any,
    "POST https://gateway.kugou.com/v2/delete_list*": { body: { status: 1 } } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:kugou-clear");
  await app.wait(400);
  expect(app.texts()).toContain("id: 42");
  expect(app.texts().some((t: string) => t.includes("歌单已清理重建"))).toBe(true);
  const urls = app.requests().map((r: any) => String(r.url ?? r));
  const delAt = urls.findIndex((u: string) => u.includes("/v2/delete_list"));
  const addAt = urls.findIndex((u: string) => u.includes("/cloudlist.service/v5/add_list"));
  expect(delAt).toBeGreaterThan(-1);
  expect(addAt).toBeGreaterThan(-1);
  // Original order: delete the old playlist first, then create the new one.
  expect(delAt).toBeLessThan(addAt);
});

test("create failure after a successful delete clears the dangling id", async () => {
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": { body: { status: 0, error: "nope" } } as any,
    "POST https://gateway.kugou.com/v2/delete_list*": { body: { status: 1 } } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:kugou-clear");
  await app.wait(500);
  expect(app.texts()).toContain("id: —");
  expect(app.texts().some((t: string) => t.includes("旧歌单已删除但重建失败"))).toBe(true);
});

test("a failed playlist write leaves the row in the queue", async () => {
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/cloudlist.service/v6/add_song*": { body: { status: 0, error: "nope" } } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await add(app, "晴天");
  await app.wait(300);
  await app.press("id:song-add-0");
  await app.wait(500);
  expect(app.texts()).toContain("点歌列表 (1)");
  expect(app.texts()).not.toContain("已点歌单 (1)");
  expect(app.texts().some((t: string) => t.includes("加入失败"))).toBe(true);
});

test("clear playlist refuses to delete a different playlist when the name was edited", async () => {
  const renamed = { ...JSON.parse(loggedConfig), target_playlist_name: "今日点歌" };
  const opts = loggedOptions();
  opts.storage = { "board.config": JSON.stringify(renamed), "kugou.session": session };
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": { body: { status: 1, data: { info: { listid: 42 } } } } as any,
    "POST https://gateway.kugou.com/v2/delete_list*": { body: { status: 1 } } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:kugou-clear");
  await app.wait(400);
  const urls = app.requests().map((r: any) => String(r.url ?? r));
  expect(urls.some((u: string) => u.includes("/v2/delete_list"))).toBe(false);
  expect(app.texts().some((t: string) => t.includes("名称与 id 不一致"))).toBe(true);
});

test("a failed delete does not switch the target id", async () => {
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": { body: { status: 1, data: { info: { listid: 42 } } } } as any,
    "POST https://gateway.kugou.com/v2/delete_list*": { body: { status: 0, error: "nope" } } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:kugou-clear");
  await app.wait(500);
  expect(app.texts()).toContain("id: 27");
  expect(app.texts().some((t: string) => t.includes("清理失败"))).toBe(true);
  const urls = app.requests().map((r: any) => String(r.url ?? r));
  expect(urls.some((u: string) => u.includes("/cloudlist.service/v5/add_list"))).toBe(false);
});

test("a failed playlist lookup creates nothing and restores the id", async () => {
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/v7/get_all_list*": { error: "timeout" } as any,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": { body: { status: 1, data: { info: { listid: 42 } } } } as any,
    "POST https://gateway.kugou.com/v2/delete_list*": { body: { status: 1 } } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:kugou-clear");
  await app.wait(500);
  expect(app.texts()).toContain("id: 27");
  expect(app.texts().some((t: string) => t.includes("歌单列表查询失败"))).toBe(true);
  const urls = app.requests().map((r: any) => String(r.url ?? r));
  expect(urls.some((u: string) => u.includes("/v2/delete_list"))).toBe(false);
  expect(urls.some((u: string) => u.includes("/cloudlist.service/v5/add_list"))).toBe(false);
});

test("a delete with an unreadable answer clears the id instead of assuming it survived", async () => {
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": { body: { status: 1, data: { info: { listid: 42 } } } } as any,
    "POST https://gateway.kugou.com/v2/delete_list*": { error: "connection reset" } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:kugou-clear");
  await app.wait(500);
  expect(app.texts()).toContain("id: —");
  expect(app.texts().some((t: string) => t.includes("删除状态未知"))).toBe(true);
  const urls = app.requests().map((r: any) => String(r.url ?? r));
  expect(urls.some((u: string) => u.includes("/cloudlist.service/v5/add_list"))).toBe(false);
});

test("a real name/id mismatch deletes nothing", async () => {
  const stale = { ...JSON.parse(loggedConfig), target_playlist_id: 99 };
  const opts = loggedOptions();
  opts.storage = { "board.config": JSON.stringify(stale), "kugou.session": session };
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": { body: { status: 1, data: { info: { listid: 42 } } } } as any,
    "POST https://gateway.kugou.com/v2/delete_list*": { body: { status: 1 } } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:kugou-clear");
  await app.wait(400);
  const urls = app.requests().map((r: any) => String(r.url ?? r));
  expect(urls.some((u: string) => u.includes("/v2/delete_list"))).toBe(false);
  expect(app.texts().some((t: string) => t.includes("名称与 id 不一致"))).toBe(true);
});

test("clear list asks for confirmation and resets the played search", async () => {
  const app = await openSqliteBoard("./Board.tsx", loggedOptions());
  await add(app, "晴天");
  await add(app, "起风了");
  await app.press("id:clear-list");
  expect(app.texts()).toContain("确认清空");
  expect(app.texts()).toContain("点歌列表 (2)");
  await app.press("id:clear-list");
  expect(app.texts()).toContain("点歌列表 (0)");
  expect(app.texts()).toContain("当前点歌列表为空");

  // Clearing played must not leave a stale search filter behind.
  await addToPlayed(app, "后来");
  await app.press("已点歌单 (1)");
  await app.type("搜索歌曲名或用户…", "后");
  await app.press("id:clear-list");
  await app.press("id:clear-list");
  expect(app.texts()).toContain("暂无已点歌曲");
  await app.press("点歌列表 (0)");
  await addToPlayed(app, "新歌");
  await app.press("已点歌单 (1)");
  expect(app.texts()).toContain("新歌");
  expect(app.texts()).not.toContain("没有匹配的歌曲");
});

async function showLogPanel(app: any) {
  await app.press("id:settings");
  await app.press("id:log-toggle");
  await app.press("id:settings-close");
}

test("log copy does not lie about its own success", async () => {
  const app = await openSqliteBoard("./Board.tsx", { width: 900, height: 700, clipboard: "INITIAL" });
  await add(app, "晴天");
  await showLogPanel(app);
  await app.press("id:log-copy");
  const clip = String(app.clipboard());
  expect(clip.length).toBeGreaterThan(0);
  expect(clip).toContain("晴天");
  expect(clip).not.toContain("日志已复制");
  await app.press("id:log-clear");
  expect(app.texts()).not.toContain("日志");
});

test("blacklist add/remove and log chevron still respond", async () => {
  const app = await openSqliteBoard("./Board.tsx", { width: 900, height: 700 });
  await app.press("黑名单 (0)");
  await app.type("输入歌曲名…", "坏歌");
  await app.press("id:black-add");
  expect(app.texts()).toContain("黑名单 (1)");
  await app.press("id:black-remove-0");
  expect(app.texts()).toContain("黑名单 (0)");
  await add(app, "晴天");
  await showLogPanel(app);
  await app.press("id:log-chevron");
  expect(app.texts().some((t: string) => t.includes("复制"))).toBe(true);
});

test("settings plugin tab only manages the plugin switch and platform login", async () => {
  const app = await openSqliteBoard("./Board.tsx", loggedOptions());
  await app.wait(200);
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  const texts = app.texts();
  expect(texts).toContain("可选一个平台，也可以都不开；歌单、自动同步与歌曲匹配只随所选平台显示。");
  expect(texts.some((t: string) => t.includes("启用酷狗服务"))).toBe(false);
  expect(texts).toContain("酷狗登录");
  expect(texts).toContain("退出登录");
  // The original never had playlist management or song search in Settings;
  // those came from the separate KuGou API debug panel.
  for (const gone of ["目标歌单", "搜索并加入", "设为目标", "加入列表", "自动歌单同步"]) {
    expect(texts).not.toContain(gone);
  }
  // "已刷新 N 个歌单" would also be a leftover debug-panel status line.
  expect(texts.some((t: string) => t.includes("刷新"))).toBe(false);
});

test("turning auto-sync on uses an existing same-name playlist", async () => {
  let adds = 0;
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": () => {
      adds += 1;
      return { body: { status: 1, data: { info: { listid: 42 } } } };
    },
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:auto-sync");
  await app.wait(400);
  expect(app.texts()).toContain("id: 27");
  expect(app.texts()).toContain("同步中");
  expect(adds).toBe(0);
});

test("turning auto-sync on creates the playlist when the name does not exist", async () => {
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/v7/get_all_list*": { body: { data: { info: [] } } } as any,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": { body: { status: 1, data: { info: { listid: 42 } } } } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:auto-sync");
  await app.wait(400);
  expect(app.texts()).toContain("id: 42");
  expect(app.texts()).toContain("同步中");
  expect(app.texts().some((t: string) => t.includes("已创建"))).toBe(true);
});

test("a failed playlist resolve leaves auto-sync off", async () => {
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/v7/get_all_list*": { error: "timeout" } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:auto-sync");
  await app.wait(400);
  expect(app.texts()).toContain("自动同步");
  expect(app.texts()).not.toContain("同步中");
  expect(app.texts().some((t: string) => t.includes("解析歌单失败"))).toBe(true);
});

test("an application-level playlist lookup error does not create a playlist", async () => {
  let adds = 0;
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/v7/get_all_list*": { body: { status: 0, data: { info: [] } } } as any,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": () => {
      adds += 1;
      return { body: { status: 1, data: { info: { listid: 42 } } } };
    },
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:auto-sync");
  await app.wait(400);
  expect(adds).toBe(0);
  expect(app.texts()).not.toContain("同步中");
  expect(app.texts().some((t: string) => t.includes("解析歌单失败"))).toBe(true);
});

test("double-pressing auto-sync while resolving creates only one playlist", async () => {
  let adds = 0;
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/v7/get_all_list*": { body: { data: { info: [] } } } as any,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": () => {
      adds += 1;
      return { body: { status: 1, data: { info: { listid: 42 } } }, delay: 400 };
    },
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:auto-sync");
  await app.press("id:auto-sync");
  await app.wait(700);
  expect(adds).toBe(1);
  expect(app.texts()).toContain("同步中");
});

test("editing the playlist name while sync is on turns sync off", async () => {
  const app = await openSqliteBoard("./Board.tsx", loggedOptions());
  await app.wait(200);
  await app.press("id:auto-sync");
  await app.wait(400);
  expect(app.texts()).toContain("同步中");
  await app.clear("测试4");
  await app.type("自动加入歌单的名字", "新名字");
  expect(app.texts()).toContain("自动同步");
  expect(app.texts()).not.toContain("同步中");
});

test("disabling the platform while sync is on turns auto-sync off", async () => {
  const opts = loggedOptions();
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:auto-sync");
  await app.wait(400);
  expect(app.texts()).toContain("同步中");
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-kugou");
  await app.press("关闭");
  expect(app.texts()).not.toContain("同步中");
  expect(app.texts()).toContain("未启用平台插件");
  // Re-enabling Kugou must not silently restart sync.
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-kugou");
  await app.press("关闭");
  expect(app.texts()).toContain("自动同步");
  expect(app.texts()).not.toContain("同步中");
});

test("a resolve that finishes after the platform is disabled cannot re-enable sync", async () => {
  const opts = loggedOptions();
  opts.network = {
    ...kugouNetwork,
    "POST https://gateway.kugou.com/v7/get_all_list*": { body: { status: 1, data: { info: [] } }, delay: 700 } as any,
    "POST https://gateway.kugou.com/cloudlist.service/v5/add_list*": { body: { status: 1, data: { info: { listid: 42 } } } } as any,
  };
  const app = await openSqliteBoard("./Board.tsx", opts);
  await app.wait(200);
  await app.press("id:auto-sync");
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-kugou");
  await app.press("关闭");
  await app.wait(1200);
  expect(app.texts()).toContain("未启用平台插件");
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-kugou");
  await app.press("关闭");
  expect(app.texts()).not.toContain("同步中");
});

test("about check-update and theme buttons respond", async () => {
  const app = await openSqliteBoard("./Board.tsx", { width: 900, height: 700 });
  await app.press("id:theme");
  await app.press("id:settings");
  await app.press("id:settings-tab-about");
  await app.press("id:about-update");
  await app.wait(100);
  expect(app.texts().some((t: string) => t.includes("最新") || t.includes("更新源") || t.includes("正在检查"))).toBe(true);
  await app.press("id:settings-close");
  expect(app.texts()).toContain("手动点歌");
});
