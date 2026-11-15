import { expect, open, test } from "nsh/test";
import process from "process";
import { VALUE } from "./win-input-value";

test("the packaged input draws typed text and its selection", async () => {
  if (process.platform !== "windows") return;
  const app = await open("./input-smoke/App.tsx", { width: 640, height: 240 });
  await app.setColorScheme("light");
  await app.type("id:field", VALUE);
  expect(app.value("id:field")).toBe(VALUE);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await app.screenshot("win-input-value.png");
  await app.keyboard.press("mod+a");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await app.screenshot("win-input-selected.png");
  app.dispose();
});
