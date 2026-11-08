import { expect, open, test } from "nsh/test";

test("douyin room fetch", async () => {
  const app = await open("./App.tsx", { network: "live" });
  await new Promise((r) => setTimeout(r, 5000));
  const texts = app.texts();
  console.log("TEXTS:", JSON.stringify(texts));
  expect(texts.join(" ")).toContain("HTTP");
});
