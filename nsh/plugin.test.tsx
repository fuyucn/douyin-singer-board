import { expect, test } from "nsh/test";
import { openSqliteBoard } from "./sqlite-test-options";

// The whole path, through the real filesystem and a real web view: install
// writes `${dataDir}/plugins/demo/`, enabling mounts a hidden WebView that runs
// the plugin's module, and the app calls it over the bridge. Each run gets its
// own data directory from the runner, so nothing here has to clean up after
// another. `--target macos`: fs and web views need a real platform.
test("a plugin installs on disk, runs hidden, and answers the app", async () => {
  const app = await openSqliteBoard("./Board.tsx", { width: 1000, height: 800 });

  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  expect(app.texts()).toContain("插件通道（实验）");
  expect(app.texts().join(" ")).toContain("还没有插件");

  // Install writes the folder; the panel lists it because reading it back from
  // disk found a valid plugin.json.
  await app.press("id:plugin-install-demo");
  await app.wait(900);
  expect(app.texts()).toContain("示例插件");
  expect(app.texts().join(" ")).not.toContain("还没有插件");

  // Enable mounts the hidden web view and loads the page in it.
  await app.press("id:plugin-toggle-demo");
  await app.wait(1600);
  // The view that runs it is hidden on purpose (a plugin has no UI of the
  // app's), so what proves it loaded is the answer below.
  expect(app.texts().join(" ")).toContain("已启用");

  // The app calls the plugin. It answers, and the call it makes back into the
  // app's storage round-trips: the second call sees the first one's write.
  await app.press("id:plugin-hello-demo");
  await app.wait(900);
  const first = app.texts().find((t: string) => t.startsWith("hello →"));
  expect(first).toBeTruthy();
  expect(first).toContain('"runs":1');

  await app.press("id:plugin-hello-demo");
  await app.wait(900);
  const second = app.texts().find((t: string) => t.startsWith("hello →"));
  expect(second).toContain('"runs":2');

  // A list-returning method: the panel shows the first item the plugin made.
  await app.press("id:plugin-search-demo");
  await app.wait(900);
  expect(app.texts().join(" ")).toContain("示例 - 晴天");

  // Uninstall removes the folder: rescanning finds nothing left.
  await app.press("id:plugin-remove-demo");
  await app.wait(900);
  expect(app.texts().join(" ")).toContain("还没有插件");
});

test("calling a plugin that is not enabled says so instead of failing", async () => {
  const app = await openSqliteBoard("./Board.tsx", { width: 1000, height: 800 });
  await app.press("id:settings");
  await app.press("id:settings-tab-plugin");
  await app.press("id:plugin-install-demo");
  await app.wait(900);
  await app.press("id:plugin-hello-demo");
  await app.wait(600);
  expect(app.texts()).toContain("请先启用");
});
