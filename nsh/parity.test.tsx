import { expect, open, test } from "nsh/test";

test("about dialog shows version, repo and update action", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  await app.press("id:about");
  const texts = app.texts();
  expect(texts).toContain("SUSUSongBoard");
  expect(texts).toContain("v0.6.0 · NSH 原生版");
  expect(texts).toContain("仓库：fuyucn/douyin-singer-board · 分支 nsh");
  expect(texts).toContain("检查更新");
  await app.press("id:about-close");
  expect(app.texts()).not.toContain("检查更新");
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
  expect(app.texts()).toContain("启用酷狗服务");
  await app.press("id:kugou-toggle");
  expect(app.texts()).toContain("酷狗服务已停用，上方开关可重新启用。");
  expect(app.texts()).not.toContain("管理酷狗音乐");
  await app.press("id:kugou-toggle");
  expect(app.texts()).toContain("管理酷狗音乐");
  await app.press("关闭");
  expect(app.texts()).toContain("手动点歌");
});
