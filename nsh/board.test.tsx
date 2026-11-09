import { expect, open, test } from "nsh/test";

test("board shell, simulated request and tabs", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  expect(app.texts()).toContain("SUSUSongBoard");
  expect(app.texts()).toContain("抖音房间号");
  expect(app.texts()).toContain("点歌 0");

  await app.press("模拟");
  await new Promise((r) => setTimeout(r, 500));
  expect(app.texts()).toContain("晴天");
  expect(app.texts()).toContain("测试观众");
  expect(app.texts()).toContain("点歌 1");

  await app.press("测试观众");
  await app.press("标记已点");
  expect(app.texts()).toContain("已点 1");
  expect(app.texts()).toContain("点歌 0");

  expect(app.texts()).toContain("插件");
  expect(app.texts()).toContain("酷狗音乐");
  expect(app.texts()).toContain("内置 v0.1.0 · 搜索 / 歌单 / 加歌");
  await app.press("打开");
  expect(app.texts()).toContain("酷狗登录");
  expect(app.texts()).toContain("生成登录二维码 / 刷新");

  await app.press("黑名单 0");
  expect(app.texts()).toContain("黑名单为空；命中的歌曲不会进入点歌列表");

  await app.type("歌曲名（精确匹配）", "晴天");
  await app.press("加入");
  expect(app.texts()).toContain("黑名单 1");
  await app.press("移除");
  expect(app.texts()).toContain("黑名单 0");
});
