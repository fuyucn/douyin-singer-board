import { expect, open, test } from "nsh/test";

test("IconButton centers its icon at every size", async () => {
  const app = await open("./geometry-entry.tsx", { width: 900, height: 700 });
  await app.waitUntil(() => app.texts().some((t) => t.startsWith("GEOM|")), { timeout: 5000 });
  const report = app.texts().find((t) => t.startsWith("GEOM|"));
  expect(typeof report).toBe("string");
  const entries = String(report).slice(5).split(";").filter(Boolean);
  expect(entries.length).toBe(6);
  const bad = entries.filter((e) => {
    const [key, values] = e.split("=");
    const [dx, dy] = values.split(",").map(Number);
    // In an icon+label button the glyph sits left of the text by design; only
    // vertical centering applies there. Icon-only buttons need both axes.
    if (key === "with-text") return Math.abs(dy) > 1;
    return Math.abs(dx) > 1 || Math.abs(dy) > 1;
  });
  expect(bad).toEqual([]);
});
