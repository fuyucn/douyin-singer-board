import { expect, open, test } from "nsh/test";
import process from "process";
import { VALUE } from "./win-input-value";

// A real Windows renderer only. The pixels are the assertion: the fields'
// text and their selections, drawn at the scale NSH_TEST_SCALE forces (1.0
// is the machine's own), are left on disk for scripts/check_win_input.py to
// measure - the text inside the field, as tall as the mirror's, and a
// selection fill wide enough to see. The headless targets draw nothing.
test("the Windows input draws its text and selection inside the field", async () => {
  if (process.platform !== "windows") return;
  const app = await open("./win-input-entry.tsx", { width: 800, height: 640 });
  await app.setColorScheme("light");
  await app.type("id:field", VALUE);
  expect(app.value("id:field")).toBe(VALUE);
  await new Promise((r) => setTimeout(r, 300));
  await app.screenshot("win-input-value.png");
  await app.keyboard.press("mod+a");
  await new Promise((r) => setTimeout(r, 300));
  await app.screenshot("win-input-selected.png");
  // The same value in faces a user's Windows has: which of them renders
  // CJK is what the run is for.
  await app.type("id:field-yahei", VALUE);
  await app.type("id:field-simsun", VALUE);
  await new Promise((r) => setTimeout(r, 300));
  await app.screenshot("win-input-faces.png");
  app.dispose();
});
