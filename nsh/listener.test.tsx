import { expect, open, test } from "nsh/test";

test("douyin listener handshake and frames", async () => {
  const app = await open("./App.tsx", { network: "live", width: 900, height: 600 });
  await new Promise((r) => setTimeout(r, 90000));
  const texts = app.texts();
  console.log("TEXTS:", JSON.stringify(texts));
  expect(texts.join(" ")).toContain("open");
}, 100000);
