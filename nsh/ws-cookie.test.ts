import { test } from "nsh/test";
import { connect } from "websocket";

// The Douyin listener needs an explicit Cookie handshake header. NSH stable
// 0.4.0 refuses it; this test proves the nightly runtime (including Windows)
// accepts it. A public echo endpoint keeps the check independent of Douyin.
test("Cookie handshake header is accepted", async () => {
  const conn = await connect("wss://ws.postman-echo.com/raw", {
    headers: { Cookie: "nsh=test" },
  });
  await conn.close();
}, 20000);
