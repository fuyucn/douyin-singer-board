import { expect, test } from "nsh/test";
import { openSqliteBoard } from "../sqlite-test-options";

// The plugin runs in a WebView, so this needs `--target macos` / `windows`.
// It prints what the plugin computed; scripts/kat-kugou-plugin.mjs checks that
// against Node's crypto.
test("kugou plugin computes the known answers", async () => {
  const app = await openSqliteBoard("../Board.tsx", { width: 1000, height: 800 });
  await app.wait(700);
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  if (app.shows("id:kw-install")) await app.press("id:kw-install");
  await app.wait(900);
  // The seeded config already selects the platform; pressing would turn it off.
  if (app.texts().includes("启用")) await app.press("id:plugin-kugou");
  await app.wait(1800);
  await app.press("id:kw-selftest");
  await app.wait(1200);
  const answer = app.texts().find((t) => t.startsWith("{") && t.includes("rsaHex"));
  expect(answer).toBeTruthy();
  console.log("KAT_JSON=" + answer);
});
