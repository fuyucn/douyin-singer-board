import { expect, open, test } from "nsh/test";
import { openSqliteBoard } from "./sqlite-test-options";

test("native SQLite writes, validates batches and removes without JSON writes", async () => {
  const app = await open("./sqlite-store-entry.tsx", {
    storage: { "board.config": JSON.stringify({ room_id: "fixture-seed" }) },
  });
  expect(app.texts().some((s: string) => s.includes("fixture-seed"))).toBe(true);
  await app.press("id:sqlite-write");
  expect(app.texts().some((s: string) => s.includes("sqlite-room") && s.includes("fixture-session"))).toBe(true);
  expect(app.storage()["board.config"]).toContain("fixture-seed");
  expect(app.storage()["board.theme"]).toBe(undefined);
  await app.press("id:sqlite-invalid");
  expect(app.texts().some((s: string) => s.startsWith("rejected: ") && s.includes("dark") && s.includes("sqlite-room"))).toBe(true);
  await app.press("id:sqlite-remove");
  expect(app.texts().some((s: string) => s.includes("fixture-session"))).toBe(false);
});

test("Board startup failure does not persist defaults or activate a session", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    storage: { "board.config": "{broken", "kugou.session": "fixture-session" },
  });
  expect(app.texts()).toContain("SQLite 初始化失败，旧数据未覆盖，请检查后重启");
  expect(app.storage()["board.config"]).toBe("{broken");
  expect(app.storage()["kugou.session"]).toBe("fixture-session");
});
