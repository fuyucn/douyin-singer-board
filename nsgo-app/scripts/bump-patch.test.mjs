import test from "node:test";
import assert from "node:assert/strict";
import { bumpPatch } from "./bump-patch.mjs";

test("increments only the patch or edition counter", () => {
  assert.equal(bumpPatch("0.43.0-preview.1"), "0.43.0-preview.2");
  assert.equal(bumpPatch("0.42.1-susu.1"), "0.42.1-susu.2");
  assert.equal(bumpPatch("0.0.30-24"), "0.0.30-25");
  assert.equal(bumpPatch("0.42.1"), "0.42.2");
  assert.throws(() => bumpPatch("0.42"));
  assert.throws(() => bumpPatch("0.42.1-dev"));
});
