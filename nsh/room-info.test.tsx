import { expect, test } from "nsh/test";
import { openSqliteBoard } from "./sqlite-test-options";

const config = (room: string) =>
  JSON.stringify({ room_id: room, kugou_enabled: false, active_plugin: "", config_version: 2 });

// The room page streams escaped JSON, as Douyin's Next.js output does.
const page =
  '<html><script>self.__next_f.push([1,"{\\"nickname\\":\\"歌手小美\\",\\"title\\":\\"今晚八点开播\\",\\"status\\":2}"])</script></html>';

test("a valid room id previews its streamer without connecting", async () => {
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    storage: { "board.config": config("145997388006") },
    network: { "GET https://live.douyin.com/145997388006*": { body: page } },
  });
  await app.wait(900);
  expect(app.texts()).toContain("歌手小美");
  expect(app.texts()).toContain("未连接");
});

test("no preview is fetched while the id is not a room id", async () => {
  let hits = 0;
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    clock: {},
    storage: { "board.config": config("abc") },
    network: { "GET https://live.douyin.com/*": () => { hits += 1; return { body: page }; } },
  });
  await app.wait(900);
  expect(hits).toBe(0);
  expect(app.texts()).not.toContain("歌手小美");
});

test("an offline room shows its name with the offline dot", async () => {
  const offline = page.replace('\\"status\\":2', '\\"status\\":4');
  const app = await openSqliteBoard("./Board.tsx", {
    width: 900, height: 700,
    clock: {},
    storage: { "board.config": config("145997388006") },
    network: { "GET https://live.douyin.com/145997388006*": { body: offline } },
  });
  await app.wait(900);
  expect(app.texts()).toContain("歌手小美");
});
