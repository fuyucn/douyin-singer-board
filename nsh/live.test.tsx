import { expect, open, test } from "nsh/test";

// Non-blocking live check: GitHub runners may not reach Douyin, and the demo
// room can go offline. Kept separate from the deterministic Cookie/WS test.
test("live room handshake", async () => {
  const app = await open("./Board.tsx", { width: 900, height: 700, network: "live" });
  await app.press("id:start");
  await new Promise((r) => setTimeout(r, 12000));
  expect(app.texts()).toContain("已连接");
}, 40000);
