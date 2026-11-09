import { expect, open, test } from "nsh/test";

type Box = { x: number; y: number; w: number; h: number };

test("fixed-height text buttons center their label like shadcn", async () => {
  const app = await open("./text-layout-entry.tsx", { width: 900, height: 700 });
  await app.waitUntil(() => app.texts().some((t) => t.startsWith("TEXT|") && t.includes("rowText")), { timeout: 5000 });
  const line = app.texts().find((t) => t.startsWith("TEXT|"))!;
  const map: Record<string, Box> = {};
  for (const part of line.slice(5).split(";")) {
    const [k, v] = part.split("=");
    const [x, y, w, h] = v.split(",").map(Number);
    map[k] = { x, y, w, h };
  }

  // Control: the unstyled NSH Button stretches the label and pins it to the top.
  expect(map.plainText.w).toBeGreaterThan(100);
  expect(map.plainText.y).toBe(0);

  // Centered: label is intrinsic width and vertically centered in its 32pt box.
  const btn = map.centeredBtn;
  const label = map.centeredText;
  expect(label.w).toBeLessThan(40);
  expect(Math.abs(label.x + label.w / 2 - btn.w / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(label.y + label.h / 2 - btn.h / 2)).toBeLessThanOrEqual(1);

  // Icon + label stay on one row, and the group is horizontally centered.
  const icon = map.rowIcon;
  const text = map.rowText;
  expect(Math.abs((icon.y + icon.h / 2) - (text.y + text.h / 2))).toBeLessThanOrEqual(1);
  const left = Math.min(icon.x, text.x);
  const right = Math.max(icon.x + icon.w, text.x + text.w);
  expect(Math.abs((left + right) / 2 - map.rowBtn.w / 2)).toBeLessThanOrEqual(1);
});
