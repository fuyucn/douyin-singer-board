import { expect, open, test } from "nsh/test";
test("kugou login QR from settings", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700, network: "live" });
  await app.press("设置");
  await app.press("生成登录二维码 / 刷新");
  await new Promise((r) => setTimeout(r, 4000));
  expect(app.texts()).toContain("状态：等待扫码");
}, 30000);
