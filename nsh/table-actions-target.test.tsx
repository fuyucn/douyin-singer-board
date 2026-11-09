import { expect, open, test } from "nsh/test";
test("table toolbar works on a real renderer", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700, clipboard: "INITIAL" });
  await app.type("输入歌曲名称...", "晴天");
  await app.press("添加");
  await app.type("输入歌曲名称...", "起风了");
  await app.press("添加");
  expect(app.texts()).toContain("选中：起风了");
  await app.press("id:toolbar-copy");
  expect(app.clipboard()).toBe("起风了");
  expect(app.texts().some((t: string) => t.includes("已复制"))).toBe(true);
  await app.press("id:toolbar-delete");
  expect(app.texts()).toContain("点歌列表 (1)");
  expect(app.texts()).toContain("晴天");
  expect(app.texts()).not.toContain("起风了");
  await app.press("id:toolbar-mark");
  expect(app.texts()).toContain("已点歌单 (1)");
  await app.press("已点歌单 (1)");
  await app.press("id:played-toolbar-copy");
  expect(app.clipboard()).toBe("晴天");
});

test("onRowPress selects a non-first row on a real renderer", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700 });
  for (const name of ["第一首", "第二首", "第三首"]) {
    await app.type("输入歌曲名称...", name);
    await app.press("添加");
  }
  expect(app.texts()).toContain("选中：第三首");
  await app.press("text:第一首");
  expect(app.texts()).toContain("选中：第一首");
  await app.press("id:toolbar-delete");
  expect(app.texts()).toContain("点歌列表 (2)");
  expect(app.texts()).not.toContain("第一首");
  expect(app.texts()).toContain("第三首");
  expect(app.texts().some((t: string) => t.includes("已删除：第一首"))).toBe(true);
});
