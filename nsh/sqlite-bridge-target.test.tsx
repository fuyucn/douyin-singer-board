import { expect, open, test } from "nsh/test";

// Run with: nsh test sqlite-bridge-target.test.tsx --target macos
// Headless has process.dataDir === null; the real renderer has a temp
// app-data dir where fs/promises can write and read the SQLite bridge.
test("fs/promises SQLite bridge auto-imports on a real renderer", async () => {
  const app = await open("./sqlite-bridge-target-entry.tsx", { width: 400, height: 200 });
  await app.wait(700);
  const texts = app.texts();
  expect(texts).toContain("source:tauri-sqlite");
  expect(texts).toContain("room:999");
  expect(texts).toContain("blacklist:海阔天空");
  expect(texts.some((t: string) => t.startsWith("session:") && t.includes("UID999"))).toBe(true);
});
