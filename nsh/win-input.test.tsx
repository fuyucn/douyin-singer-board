import { expect, open, test } from "nsh/test";
import process from "process";
import { VALUE } from "./win-input-value";

// A real Windows renderer only. The pixels are the assertion: the field's
// text and its selection, drawn at the scale NSH_TEST_SCALE forces (1.0 is
// the machine's own), are left on disk for scripts/check_win_input.py to
// measure - the text inside the blue border, as tall as the mirror's, and
// a selection fill wide enough to see. The headless targets draw nothing.
test("the Windows input draws its text and selection inside the field", async () => {
  if (process.platform !== "windows") return;
  const scale = process.env.NSH_TEST_SCALE ?? "1.0";
  const app = await open("./win-input-entry.tsx", { width: 800, height: 600 });
  await app.setColorScheme("light");
  await app.type("id:field", VALUE);
  expect(app.value("id:field")).toBe(VALUE);
  await new Promise((r) => setTimeout(r, 300));
  await app.screenshot(`win-input-${scale}-value.png`);
  await app.press("id:field");
  await app.keyboard.press("mod+a");
  await new Promise((r) => setTimeout(r, 300));
  await app.screenshot(`win-input-${scale}-selected.png`);
  app.dispose();
});
