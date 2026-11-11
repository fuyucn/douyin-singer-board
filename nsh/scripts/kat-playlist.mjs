// Known-answer test for the NSH playlist crypto port.
// Usage:
//   nsh test scripts/kat-playlist.test.ts > /tmp/kat-nsh.txt 2>&1
//   node scripts/kat-playlist.mjs /tmp/kat-nsh.txt
import { createHash, createCipheriv, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

// Reference constants from kugou-api/util/crypto.js and helper.js. These are
// deliberately NOT read from the NSH output: the KAT must be independent.
const KUGOU_PEM_B64 = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB";
const AES = "a1b2c3";
const DATA = { listid: 29, total_ver: 0, type: 1 };
const MSG = JSON.stringify({ aes: AES, uid: "123456", token: "TESTTOKEN" });
const CLIENTTIME = "1700000000";
const APPID = "1005";
const SALT = "OIlwieks28dk2k092lksi2UIkp";
const CLIENTVER = "20489";

const file = process.argv[2] ?? "/tmp/kat-nsh.txt";
const text = readFileSync(file, "utf8");
const line = text.split("\n").find((l) => l.includes("KAT_JSON="));
if (!line) throw new Error("no KAT_JSON in " + file);
const kat = JSON.parse(line.slice(line.indexOf("KAT_JSON=") + "KAT_JSON=".length));

const md5 = (s) => createHash("md5").update(s).digest("hex");
const h = md5(AES);
const key = Buffer.from(h.substring(0, 16), "utf8");
const iv = Buffer.from(h.substring(16, 32), "utf8");
const cipher = createCipheriv("aes-128-cbc", key, iv);
const expectedAes = Buffer.concat([
  cipher.update(Buffer.from(JSON.stringify(DATA), "utf8")),
  cipher.final(),
]).toString("base64");
const expectedSign = md5(`${APPID}${SALT}${CLIENTVER}${CLIENTTIME}`);

// Node parses KuGou's SPKI key from the hardcoded PEM, independently of the
// NSH DER parser.
const pem = `-----BEGIN PUBLIC KEY-----\n${KUGOU_PEM_B64}\n-----END PUBLIC KEY-----`;
const jwk = createPublicKey(pem).export({ format: "jwk" });
const n = BigInt("0x" + Buffer.from(jwk.n, "base64url").toString("hex"));
const e = BigInt("0x" + Buffer.from(jwk.e, "base64url").toString("hex"));
const size = Math.ceil(n.toString(2).length / 8);
const msgBytes = Buffer.from(MSG, "utf8");
const psLen = size - msgBytes.length - 3;
const paddingHex = "01".repeat(psLen);
const em = Buffer.concat([
  Buffer.from([0, 2]), Buffer.from(paddingHex, "hex"), Buffer.from([0]), msgBytes,
]);
let result = 1n;
let base = BigInt("0x" + em.toString("hex")) % n;
let exp = e;
while (exp > 0n) {
  if (exp & 1n) result = (result * base) % n;
  exp >>= 1n;
  base = (base * base) % n;
}
const expectedP = result.toString(16).padStart(size * 2, "0").toUpperCase();

const checks = [
  ["md5", kat.md5, md5("abc")],
  ["signParamsKey", kat.signParamsKey, expectedSign],
  ["AES-CBC ciphertext", kat.aes, expectedAes],
  ["AES roundtrip", JSON.stringify(kat.dec), JSON.stringify(DATA)],
  ["RSA modulus (Node SPKI)", kat.n, n.toString(16)],
  ["RSA exponent (Node SPKI)", kat.e, e.toString(16)],
  ["RSA key size", kat.size, size],
  ["RSA PKCS1 v1.5 p", kat.p, expectedP],
  ["fixed padding hex", kat.paddingHex, paddingHex],
  ["RSA message payload", kat.msg, MSG],
  ["random PS branch (e=1 EM)", kat.randomPsOk, true],
  ["random PS ciphertext length", kat.pRandom?.length, size * 2],
  ["random PS differs from fixed", kat.pRandom !== kat.p, true],
  ["binary AES response", Number(kat.binaryResp?.status), 1],
  ["plain JSON response", Number(kat.jsonResp?.status), 1],
  ["base64-text response", Number(kat.b64TextResp?.status), 1],
];
let bad = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : `\n  NSH : ${String(got).slice(0, 140)}\n  Node: ${String(want).slice(0, 140)}`}`);
}
console.log(bad === 0 ? "KAT OK: NSH playlist crypto matches Node." : `KAT FAILED: ${bad} mismatch(es).`);
process.exit(bad === 0 ? 0 : 1);
