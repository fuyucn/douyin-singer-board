import { expect, open, test } from "nsh/test";

test("board shell, manual request, tabs and plugin settings", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  expect(app.texts()).toContain("SUSUSongBoard");
  expect(app.texts()).toContain("抖音直播间 ID");
  expect(app.texts()).toContain("点歌列表 (0)");

  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  expect(app.texts()).toContain("晴天");
  expect(app.texts()).toContain("点歌列表 (1)");

  await app.press("id:mark-0");
  expect(app.texts()).toContain("已点歌单 (1)");
  expect(app.texts()).toContain("点歌列表 (0)");

  await app.press("id:settings");
  expect(app.texts()).toContain("常规");
  expect(app.texts()).toContain("外观");
  expect(app.texts()).not.toContain("平台插件");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("平台插件");
  expect(app.texts()).toContain("酷狗音乐");
  expect(app.texts()).toContain("网易云音乐");
  expect(app.texts()).toContain("同一时间只启用一个平台插件；切换后另一个平台的登录与自动同步会停用。");
  await app.press("启用");
  expect(app.texts()).toContain("尚未接入。切换回酷狗即可继续管理歌单；同一时间只启用一个平台。");
  await app.press("启用");
  expect(app.texts()).toContain("管理酷狗音乐");
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
