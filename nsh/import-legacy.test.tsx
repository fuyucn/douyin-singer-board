import { expect, open, test } from "nsh/test";

test("importing a Tauri migration JSON writes config, theme and session", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  const payload = {
    "board.config": JSON.stringify({
      room_id: "697336653874", sing_prefix: "[song]", fans_level: 0, sing_cd: 0,
      cooldown_seconds: 1800, max_songs_per_user: 4,
      target_playlist_name: "测试4", target_playlist_id: 27,
      kugou_enabled: true, blacklist: ["海阔天空"], blacklist_singers: ["Bsh"],
      blacklist_meta: { "song:海阔天空": 1777492126 },
      auto_sync: false, active_plugin: "kugou", config_version: 2,
    }),
    "board.theme": "dark",
    "kugou.session": JSON.stringify({ token: "TOK", userid: "2497428573", dfid: "DFID", nickname: "2497428573" }),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  app.onPick(() => [{ name: "storage.json", type: "application/json", data: bytes }]);
  await app.wait(100);
  await app.press("id:settings");
  await app.press("id:settings-tab-about");
  await app.press("id:about-import-legacy");
  await app.wait(400);
  expect(app.texts().some((t: string) => t.includes("原版数据导入成功"))).toBe(true);
  // NSH Storage remains untouched; the import now commits to SQLite.
  expect(app.storage()["board.config"]).toBe(undefined);
  expect(app.storage()["kugou.session"]).toBe(undefined);
  expect(app.texts()).toContain("id: 27");
  await app.press("id:settings-tab-plugin");
  expect(app.texts().some((t: string) => t.includes("2497428573"))).toBe(true);
  await app.press("关闭");
  await app.press("黑名单 (2)");
  expect(app.texts()).toContain("海阔天空");
});
