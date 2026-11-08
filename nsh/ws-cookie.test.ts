import { expect, test } from "nsh/test";
import { connect } from "websocket";

// The Douyin listener needs an explicit Cookie handshake header. NSH stable
// 0.4.0 refuses it; this test proves the nightly runtime (including Windows)
// accepts it. A public echo endpoint keeps the check independent of Douyin.
test("Cookie handshake header is accepted", async () => {
  const conn = await connect("wss://ws.postman-echo.com/raw", {
    headers: { Cookie: "nsh=test" },
  });
  await conn.write("nsh-ok");
  let echoed = "";
  for (let i = 0; i < 4 && !echoed; i++) {
    const message = await conn.read();
    if (message === null) break;
    if (String(message).includes("nsh-ok")) echoed = String(message);
  }
  expect(echoed).toContain("nsh-ok");
  await conn.close();
}, 20000);
