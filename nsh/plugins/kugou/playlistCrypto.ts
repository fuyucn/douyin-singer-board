// Port of kugou-api/util/crypto.js + util/helper.js for the playlist delete
// endpoint. Pure functions (no fetch) so the same encodings can be checked
// against Node in scripts/kat-playlist.mjs. Nothing here talks to a network.
import { createHash, randomBytes, webcrypto } from "crypto";
import { Buffer } from "buffer";

export const ANDROID_SALT = "OIlwieks28dk2k092lksi2UIkp";
export const APPID = "1005";
export const CLIENTVER = "20489";

// kugou-api/util/crypto.js publicRasKey (SPKI, 1024-bit RSA).
export const KUGOU_PUBLIC_KEY_B64 =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB";

const subtle: any = (webcrypto as any)?.subtle ?? (globalThis as any)?.crypto?.subtle;

export function md5(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

/** signParamsKey = MD5(appid + salt + clientver + clienttime). */
export function signParamsKey(clienttime: string | number): string {
  return md5(`${APPID}${ANDROID_SALT}${CLIENTVER}${clienttime}`);
}

/** kugou-api randomString(6).toLowerCase(): digits + lowercase letters. */
export function randomAesKey(): string {
  const chars = "1234567890abcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/** AES-128-CBC key/iv: the first/second 16 *hex characters* of md5(aes),
 *  used as UTF-8 bytes (crypto-js `enc.Utf8.parse`), not decoded hex. */
export function aesKeyIv(aes: string): { key: Uint8Array; iv: Uint8Array } {
  const h = md5(aes);
  return {
    key: new Uint8Array(Buffer.from(h.substring(0, 16), "utf8")),
    iv: new Uint8Array(Buffer.from(h.substring(16, 32), "utf8")),
  };
}

export async function aesEncryptB64(data: unknown, aes: string): Promise<string> {
  const { key, iv } = aesKeyIv(aes);
  const k = await subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const plain = new Uint8Array(Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8"));
  const enc = await subtle.encrypt({ name: "AES-CBC", iv }, k, plain);
  return Buffer.from(enc).toString("base64");
}

export async function aesDecryptB64(b64: string, aes: string): Promise<any> {
  const { key, iv } = aesKeyIv(aes);
  const k = await subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);
  const dec = await subtle.decrypt({ name: "AES-CBC", iv }, k, Buffer.from(b64, "base64"));
  const text = Buffer.from(dec).toString("utf8");
  try { return JSON.parse(text); } catch { return text; }
}

function readLen(buf: Buffer, p: { i: number }): number {
  const first = buf[p.i++];
  if (first < 0x80) return first;
  const n = first & 0x7f;
  let len = 0;
  for (let j = 0; j < n; j++) len = (len << 8) | buf[p.i++];
  return len;
}

function readTlv(buf: Buffer, p: { i: number }): { tag: number; value: Buffer } {
  const tag = buf[p.i++];
  const len = readLen(buf, p);
  const value = buf.subarray(p.i, p.i + len);
  p.i += len;
  return { tag, value };
}

/** Minimal SPKI parse: Sequence(AlgorithmIdentifier, BIT STRING(Sequence(INTEGER n, INTEGER e))). */
export function parseRsaPublicKey(): { n: bigint; e: bigint; size: number } {
  const der = Buffer.from(KUGOU_PUBLIC_KEY_B64, "base64");
  const p1 = { i: 0 };
  const outer = readTlv(der, p1).value;
  const p2 = { i: 0 };
  readTlv(outer, p2); // AlgorithmIdentifier
  const bit = readTlv(outer, p2).value;
  const p3 = { i: 1 }; // first byte of BIT STRING = unused bits
  const seq = readTlv(bit, p3).value;
  const p4 = { i: 0 };
  const nBuf = readTlv(seq, p4).value;
  const eBuf = readTlv(seq, p4).value;
  const n = BigInt("0x" + nBuf.toString("hex"));
  const e = BigInt("0x" + eBuf.toString("hex"));
  const size = Math.ceil(n.toString(2).length / 8);
  return { n, e, size };
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

/** RSAES-PKCS1-V1_5, uppercase hex (node-forge `RSAES-PKCS1-V1_5`).
 *  `fixedPaddingHex` is only for the Node known-answer test; production uses
 *  random non-zero PS bytes. Optional n/e let the KAT use a generated key. */
export function rsaEncryptPkcs1(
  message: string,
  fixedPaddingHex?: string,
  nHex?: string,
  eHex?: string,
): string {
  const parsed = nHex ? null : parseRsaPublicKey();
  const n = nHex ? BigInt("0x" + nHex) : parsed!.n;
  const e = eHex ? BigInt("0x" + eHex) : parsed!.e;
  const k = nHex ? Math.ceil(nHex.length / 2) : parsed!.size;
  const m = new Uint8Array(Buffer.from(message, "utf8"));
  const psLen = k - m.length - 3;
  if (psLen < 8) throw new Error("RSA message too long");
  let ps: number[];
  if (fixedPaddingHex) {
    const b = Buffer.from(fixedPaddingHex, "hex");
    if (b.length !== psLen) throw new Error(`KAT padding must be ${psLen} bytes`);
    ps = Array.from(b);
  } else {
    ps = Array.from(randomBytes(psLen)).map((x) => (x === 0 ? 1 : x));
  }
  if (ps.some((x) => x === 0)) throw new Error("RSA PS must not contain zero bytes");
  const em = new Uint8Array(k);
  em[0] = 0;
  em[1] = 2;
  for (let i = 0; i < psLen; i++) em[2 + i] = ps[i];
  em[2 + psLen] = 0;
  em.set(m, 3 + psLen);
  const c = modPow(BigInt("0x" + Buffer.from(em).toString("hex")), e, n);
  return c.toString(16).padStart(k * 2, "0").toUpperCase();
}
