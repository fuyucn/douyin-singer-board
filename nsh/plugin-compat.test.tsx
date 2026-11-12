import { expect, open, test } from "nsh/test";

// A plugin written for a newer bridge: the folder survives an app update, so it
// must stay visible and say why it is not loaded, not vanish.
test("a plugin newer than the bridge is listed as incompatible", async () => {
  const app = await open("./Board.tsx", {
    width: 1000,
    height: 800,
    host: {
      params: {
        pluginTestSeed: [{
          manifest: { id: "future", name: "未来插件", version: "1.0.0", api: 2, entry: "index.js" },
          files: { "index.js": "plugin.define({ hello: () => ({ ok: true }) });\n" },
        }],
      },
    },
  });
  await app.wait(700);
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.wait(500);
  expect(app.texts()).toContain("未来插件");
  expect(app.texts().join(" ")).toContain("需要 api 2");
  await app.press("id:plugin-toggle-future");
  await app.wait(400);
  expect(app.texts().join(" ")).toContain("需要 api 2");
});
