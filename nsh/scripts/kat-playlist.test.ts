import { test } from "nsh/test";
import { Buffer } from "buffer";
import {
  aesEncryptB64, aesDecryptB64, md5, parseRsaPublicKey,
  rsaEncryptPkcs1, signParamsKey,
} from "../plugins/kugou/playlistCrypto";
import { parseDeleteResponse } from "../plugins/kugou/playlistOps";

// Deterministic known-answer output. scripts/kat-playlist.mjs hardcodes the
// same reference constants (including KuGou's real SPKI key) and recomputes
// them with Node, so a wrong encoding on the NSH side cannot pass.
test("playlist crypto KAT", async () => {
  const aes = "a1b2c3";
  const data = { listid: 29, total_ver: 0, type: 1 };
  const b64 = await aesEncryptB64(data, aes);
  const dec = await aesDecryptB64(b64, aes);
  const parsed = parseRsaPublicKey();
  const msg = JSON.stringify({ aes, uid: "123456", token: "TESTTOKEN" });
  const psLen = parsed.size - Buffer.from(msg, "utf8").length - 3;
  const paddingHex = "01".repeat(psLen);

  // Production branch: e=1 exposes EM (m^1 mod n = m), so the random non-zero
  // PS, the 00 02 / 00 delimiters and the message tail can all be inspected.
  const emHex = rsaEncryptPkcs1(msg, undefined, parsed.n.toString(16), "1");
  const em = Buffer.from(emHex, "hex");
  const randomPsOk = em.length === parsed.size
    && em[0] === 0 && em[1] === 2
    && Array.from(em.subarray(2, 2 + psLen)).every((b) => b !== 0)
    && em[2 + psLen] === 0
    && em.subarray(3 + psLen).toString("utf8") === msg;

  // The real upstream answer is raw AES ciphertext, not JSON.
  const encStatus = await aesEncryptB64({ status: 1 }, aes);
  const binaryResp = await parseDeleteResponse(new Uint8Array(Buffer.from(encStatus, "base64")), aes);
  const jsonResp = await parseDeleteResponse(new Uint8Array(Buffer.from('{"status":1}', "utf8")), aes);
  const b64TextResp = await parseDeleteResponse(new Uint8Array(Buffer.from(encStatus, "utf8")), aes);

  const out = {
    aes: b64, dec,
    md5: md5("abc"),
    signParamsKey: signParamsKey("1700000000"),
    n: parsed.n.toString(16), e: parsed.e.toString(16), size: parsed.size,
    msg, paddingHex,
    p: rsaEncryptPkcs1(msg, paddingHex),
    pRandom: rsaEncryptPkcs1(msg),
    emHex, randomPsOk,
    binaryResp, jsonResp, b64TextResp,
  };
  console.log("KAT_JSON=" + JSON.stringify(out));
});
