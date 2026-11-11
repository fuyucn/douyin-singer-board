import { expect, test } from "nsh/test";
import { openSqliteBoard, openSqliteBoardDir } from "./sqlite-test-options";

const config = JSON.stringify({ room_id: "log-probe", kugou_enabled: false, active_plugin: "" });

test("the log panel is hidden by default", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": config },
  });
  await app.press("id:settings");
  expect(app.texts()).toContain("已隐藏");
  await app.press("id:settings-close");
  expect(app.texts()).not.toContain("已显示");
});

test("the switch turns it on for this session", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": config },
  });
  await app.press("id:settings");
  await app.press("id:log-toggle");
  expect(app.texts()).toContain("已显示");
  await app.press("id:settings-close");
});

test("a stored preference survives the restart", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": config, "board.log_visible": "1" },
  });
  await app.press("id:settings");
  expect(app.texts()).toContain("已显示");
});

test("an explicit off stays off after the restart", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": config, "board.log_visible": "0" },
  });
  await app.press("id:settings");
  expect(app.texts()).toContain("已隐藏");
});

test("the preference is written to the store and read back after a restart", async () => {
  // A fresh path per run: the native store creates it, and nothing survives
  // between runs to mask a failed write.
  const dir = `/tmp/ssb-log-preference-${Date.now()}`;

  const first = await openSqliteBoardDir("./Board.tsx", dir, {
    width: 900, height: 700,
    storage: { "board.config": config },
  });
  await first.press("id:settings");
  await first.press("id:log-toggle");
  expect(first.texts()).toContain("已显示");
  await first.wait(400);

  const second = await openSqliteBoardDir("./Board.tsx", dir, { width: 900, height: 700 });
  await second.press("id:settings");
  expect(second.texts()).toContain("已显示");
});
