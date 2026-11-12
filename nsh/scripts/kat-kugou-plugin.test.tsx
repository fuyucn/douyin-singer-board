import { expect, test } from "nsh/test";
import { openSqliteBoard } from "../sqlite-test-options";

// The plugin runs in a WebView, so this needs `--target macos` / `windows`.
// It prints what the plugin computed; scripts/kat-kugou-plugin.mjs checks that
// against Node's crypto. The values arrive through a hidden line in the app
// (`pluginKugouKat`), so no debug UI is shipped for it.
test("kugou plugin computes the known answers", async () => {
  const app = await openSqliteBoard("../Board.tsx", {
    width: 1000, height: 800,
    host: { params: { pluginKugouKat: true } },
  });
  await app.wait(6000);
  const answer = app.texts().find((t) => t.startsWith("{") && t.includes("rsaHex"));
  expect(answer).toBeTruthy();
  console.log("KAT_JSON=" + answer);
}, 60000);
