import { expect, open, test } from "nsh/test";

test("IconButton centers its icon at every size", async () => {
  const app = await open("./geometry-entry.tsx", { width: 900, height: 700 });
  await app.waitUntil(() => app.texts().some((t) => t.startsWith("GEOM|")), { timeout: 5000 });
  const report = app.texts().find((t) => t.startsWith("GEOM|"));
  expect(typeof report).toBe("string");
  const entries = String(report).slice(5).split(";").filter(Boolean);
  expect(entries.length).toBe(5);
  const bad = entries.filter((e) => {
    const [dx, dy] = e.split("=")[1].split(",").map(Number);
    return Math.abs(dx) > 1 || Math.abs(dy) > 1;
  });
  expect(bad).toEqual([]);
});
