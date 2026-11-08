import { expect, open, test } from "nsh/test";

test("kugou search and qr", async () => {
  const app = await open("./App.tsx", { network: "live", width: 1000, height: 800 });
  await new Promise((r) => setTimeout(r, 1500));

  await app.press("酷狗搜索");
  await new Promise((r) => setTimeout(r, 8000));
  const afterSearch = app.texts();
  console.log("SEARCH:", JSON.stringify(afterSearch).slice(-700));
  expect(afterSearch.join(" ")).toContain("晴天");

  await app.press("扫码登录");
  await new Promise((r) => setTimeout(r, 5000));
  const afterQr = app.texts();
  console.log("QR:", JSON.stringify(afterQr).slice(-300));
  expect(afterQr.join(" ")).toContain("扫码");

  await app.press("检查扫码");
  await new Promise((r) => setTimeout(r, 4000));
  const afterCheck = app.texts();
  console.log("CHECK:", JSON.stringify(afterCheck).slice(-200));
  expect(afterCheck.join(" ")).toContain("扫码状态");
}, 40000);
