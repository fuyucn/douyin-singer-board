import { expect, test } from "nsh/test";
import process from "process";
import { openSqliteBoard } from "./sqlite-test-options";

const config = JSON.stringify({
  room_id: "145997388006", sing_prefix: "点歌[space][song]", fans_level: 0,
  sing_cd: 0, cooldown_seconds: 1800, max_songs_per_user: 3,
  target_playlist_name: "测试4", target_playlist_id: 27,
  kugou_enabled: true, blacklist: [], blacklist_singers: [],
  auto_sync: false, active_plugin: "kugou", config_version: 2,
});

const network = {
  "POST https://gateway.kugou.com/v7/get_all_list*": { body: { data: { info: [{ name: "测试4", listid: 27, count: 0 }] } } },
};

// The same BoardField branch Windows takes; textOverlay forces it elsewhere.
test("the Windows text overlay shows values and accepts typing", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: {
      "board.config": config,
      "kugou.session": JSON.stringify({ token: "TESTTOKEN", userid: "123456", dfid: "-" }),
    },
    network,
    host: { params: { textOverlay: true } },
  });
  await new Promise((r) => setTimeout(r, 800));

  expect(app.shows("text:145997388006")).toBe(true);
  await app.type("id:room-id", "695340048764");
  expect(app.value("id:room-id")).toContain("695340048764");
  expect(app.shows("text:/695340048764/")).toBe(true);

  await app.type("id:manual-song", "晴天");
  await app.press("添加");
  expect(app.texts()).toContain("点歌列表 (1)");

  await app.press("黑名单 (0)");
  await app.type("id:black-input", "晴天");
  await app.press("id:black-add");
  expect(app.texts()).toContain("黑名单 (1)");

  // A real Windows renderer leaves this behind for the CI artifact.
  if (process.platform === "win32") await app.screenshot("text-overlay.png");
});
