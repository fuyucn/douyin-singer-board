import { expect, open, test } from "nsh/test";

test("board shell and simulated request", async () => {
  const app = await open("./Board.tsx", { width: 1100, height: 720 });
  expect(app.texts()).toContain("SUSUSongBoard");
  expect(app.texts()).toContain("抖音房间号");
  expect(app.texts()).toContain("点歌列表");

  await app.press("模拟点歌");
  await new Promise((r) => setTimeout(r, 500));
  expect(app.texts()).toContain("晴天");
  expect(app.texts()).toContain("测试观众");
});
