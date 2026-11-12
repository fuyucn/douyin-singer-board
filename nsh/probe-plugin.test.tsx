import { expect, test } from "nsh/test";
import process from "process";
import { mkdir, writeFile, readFile } from "fs/promises";

test("what the test VM may write", async () => {
  const dir = (process as any).dataDir as string | null;
  console.log("DATA_DIR", JSON.stringify(dir));
  const probe = `${dir}/probe-plugin-dir/sub`;
  await mkdir(probe, { recursive: true });
  await writeFile(`${probe}/x.txt`, "hello");
  console.log("READ_BACK", await readFile(`${probe}/x.txt`, "utf8"));
  expect(true).toBe(true);
});
