// Known-answer test for the KuGou plugin's crypto (nsh/plugins/kugou-web).
//   nsh test scripts/kat-kugou-plugin.test.tsx --target macos > kat-kugou.txt 2>&1
//   node scripts/kat-kugou-plugin.mjs kat-kugou.txt
import { createHash, createCipheriv, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "kat-kugou.txt";
const text = readFileSync(file, "utf8");
const line = text.split("\n").find((l) => l.includes("KAT_JSON="));
if (!line) throw new Error("no KAT_JSON in " + file);
const kat = JSON.parse(line.slice(line.indexOf("KAT_JSON=") + "KAT_JSON=".length));
if (kat.error) throw new Error("the plugin's self-test failed: " + kat.error);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const AES = "a1b2c3";
const DATA = { listid: 29, total_ver: 0, type: 1 };
const MSG = JSON.stringify({ aes: AES, uid: "123456", token: "TESTTOKEN" });
const h = md5(AES);
const cipher = createCipheriv("aes-128-cbc", Buffer.from(h.substring(0, 16), "utf8"), Buffer.from(h.substring(16, 32), "utf8"));
const expectedAes = Buffer.concat([
  cipher.update(Buffer.from(JSON.stringify(DATA), "utf8")),
  cipher.final(),
]).toString("base64");
const expectedSign = md5("1005" + "OIlwieks28dk2k092lksi2UIkp" + "20489" + "1700000000");

const PEM = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB";
const jwk = createPublicKey({ key: Buffer.from(PEM, "base64"), format: "der", type: "spki" }).export({ format: "jwk" });
const n = BigInt("0x" + Buffer.from(jwk.n, "base64url").toString("hex"));
const e = BigInt("0x" + Buffer.from(jwk.e, "base64url").toString("hex"));
const size = Math.ceil(n.toString(2).length / 8);
const msg = Buffer.from(MSG, "utf8");
const psLen = size - msg.length - 3;
const em = Buffer.concat([Buffer.from([0, 2]), Buffer.from("01".repeat(psLen), "hex"), Buffer.from([0]), msg]);
let result = 1n, base = BigInt("0x" + em.toString("hex")) % n, exp = e;
while (exp > 0n) {
  if (exp & 1n) result = (result * base) % n;
  exp >>= 1n;
  base = (base * base) % n;
}
const expectedRsa = result.toString(16).padStart(size * 2, "0").toUpperCase();

const checks = [
  ["md5", kat.md5, md5("abc")],
  ["md5Utf8", kat.md5Utf8, md5("酷狗音乐 123")],
  ["signParamsKey", kat.signParamsKey, expectedSign],
  ["aesB64", kat.aesB64, expectedAes],
  ["rsaHex", kat.rsaHex, expectedRsa],
];
let bad = 0;
for (const [name, value, want] of checks) {
  if (value === want) continue;
  bad += 1;
  console.log(`FAIL ${name}\n  got  ${value}\n  want ${want}`);
}
if (bad) { console.log(`${bad} FAILED`); process.exit(1); }
console.log("KAT OK: the KuGou plugin's crypto matches Node.");
