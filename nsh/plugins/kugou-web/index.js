// KuGou, as a plugin: the same API the app calls (search, playlists, add,
// resolve, clear, QR login), run in a WebView instead of compiled into the app.
// Ported from nsh/plugins/kugou/*.ts, with the three Node-only pieces replaced:
//   md5        -> this file's MD5 (a page has no Node crypto)
//   Buffer     -> TextEncoder / atob / btoa / base64 helpers
//   fetch      -> app.call("http.json"), the app's own network (no CORS, and
//                 the app's capabilities still decide which hosts are reachable)
var APPID = "1005";
var CLIENTVER = "20489";
var SRCAPPID = "2919";
var ANDROID_SALT = "OIlwieks28dk2k092lksi2UIkp";
var WEB_SALT = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
var ANDROID_UA = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi";
var GATEWAY = "https://gateway.kugou.com";
var KUGOU_PUBLIC_KEY_B64 = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIAG7QOELSYoIJvTFJhMpe1s/gbjDJX51HBNnEl5HXqTW6lQ7LC8jr9fWZTwusknp+sVGzwd40MwP6U5yDE27M/X1+UR4tvOGOqp94TJtQ1EPnWGWXngpeIW5GxoQGao1rmYWAu6oi1z9XkChrsUdC6DJE5E221wf/4WLFxwAtRQIDAQAB";
var MID = String(Math.floor(Math.random() * 9000000000000000) + 1000000000000000);

// --- MD5, hex out (RFC 1321) ----------------------------------------------
function utf8(text) { return new TextEncoder().encode(String(text)); }

function md5(text) {
  var bytes = utf8(text);
  var len = bytes.length;
  var padded = new Uint8Array(((len + 8) >> 6) * 64 + 64);
  padded.set(bytes, 0);
  padded[len] = 0x80;
  var view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor((len * 8) / 4294967296) >>> 0, true);

  var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  var K = new Int32Array(64);
  for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;

  for (var off = 0; off < padded.length; off += 64) {
    var M = new Int32Array(16);
    for (var j = 0; j < 16; j++) M[j] = view.getInt32(off + j * 4, true);
    var a = a0, b = b0, c = c0, d = d0;
    for (var t = 0; t < 64; t++) {
      var f, g;
      if (t < 16) { f = (b & c) | (~b & d); g = t; }
      else if (t < 32) { f = (d & b) | (~d & c); g = (5 * t + 1) & 15; }
      else if (t < 48) { f = b ^ c ^ d; g = (3 * t + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * t) & 15; }
      var sum = (a + f + K[t] + M[g]) | 0;
      var shift = S[(t >> 4) * 4 + (t & 3)];
      var next = (b + (((sum << shift) | (sum >>> (32 - shift)) | 0))) | 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  function word(value) {
    var out = "";
    for (var i = 0; i < 4; i++) {
      var byte = (value >>> (i * 8)) & 0xff;
      out += (byte < 16 ? "0" : "") + byte.toString(16);
    }
    return out;
  }
  return word(a0) + word(b0) + word(c0) + word(d0);
}

// --- bytes / base64 / hex -------------------------------------------------
function bytesToB64(bytes) {
  var text = "";
  for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

function b64ToBytes(b64) {
  var text = atob(String(b64).replace(/\s+/g, ""));
  var out = new Uint8Array(text.length);
  for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return out;
}

function hexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// --- request signing ------------------------------------------------------
function signature(params, salt) {
  var body = Object.keys(params).sort().map(function (key) { return key + "=" + params[key]; }).join("");
  return md5(salt + body + salt);
}

function signatureWithBody(params, salt, body) {
  var text = Object.keys(params).sort().map(function (key) { return key + "=" + params[key]; }).join("");
  return md5(salt + text + body + salt);
}

function signParamsKey(clienttime) {
  return md5(APPID + ANDROID_SALT + CLIENTVER + clienttime);
}

function defaults() {
  return {
    dfid: "-",
    mid: MID,
    uuid: "-",
    appid: APPID,
    clientver: CLIENTVER,
    clienttime: String(Math.floor(Date.now() / 1000)),
  };
}

function query(params) {
  return Object.keys(params).map(function (key) {
    return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
  }).join("&");
}

// The app's own network: no CORS (a page cannot read a cross-origin answer),
// and the app's capabilities still decide which hosts are reachable.
async function http(options) {
  return await app.call("http.json", {
    url: options.url,
    method: options.method || "GET",
    headers: options.headers || null,
    body: options.body === undefined ? null : options.body,
    as: options.as || "json",
  });
}

async function getJson(base, params, salt, router) {
  var signed = Object.assign({}, params, { signature: signature(params, salt) });
  var headers = {
    "User-Agent": UA,
    dfid: params.dfid || "-",
    mid: params.mid || MID,
    clienttime: params.clienttime || String(Math.floor(Date.now() / 1000)),
  };
  if (router) headers["x-router"] = router;
  return await http({ url: base + "?" + query(signed), headers: headers });
}

async function postJson(base, params, data, router) {
  var body = JSON.stringify(data);
  var signed = Object.assign({}, params, { signature: signatureWithBody(params, ANDROID_SALT, body) });
  var headers = {
    "User-Agent": ANDROID_UA,
    "Content-Type": "application/json",
    dfid: params.dfid || "-",
    mid: params.mid || MID,
    clienttime: params.clienttime || String(Math.floor(Date.now() / 1000)),
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
  };
  if (router) headers["x-router"] = router;
  return await http({ url: base + "?" + query(signed), method: "POST", headers: headers, body: body });
}

// --- search and login -----------------------------------------------------
async function search(input) {
  var params = Object.assign({}, defaults(), {
    keyword: input.keyword,
    page: String(input.page || 1),
    pagesize: String(input.pagesize || 10),
    platform: "AndroidFilter",
    iscorrection: "1",
    privilegefilter: "0",
    area_code: "1",
    dopicfull: "1",
  });
  var json = await getJson("https://gateway.kugou.com/v2/search/song", params, ANDROID_SALT, "complexsearch.kugou.com");
  var lists = (json && json.data && json.data.lists) || [];
  return lists.map(function (item) {
    return {
      name: String(item.SongName || ""),
      artist: String(item.SingerName || ""),
      hash: String(item.FileHash || ""),
      albumId: String(item.AlbumID || ""),
      mixSongId: String(item.MixSongID || ""),
      duration: Number(item.Duration || 0),
    };
  });
}

async function loginQrKey() {
  var params = Object.assign({}, defaults(), {
    appid: "1001",
    type: "1",
    plat: "4",
    srcappid: SRCAPPID,
    qrcode_txt: "https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1001&",
  });
  var json = await getJson("https://login-user.kugou.com/v2/qrcode", params, WEB_SALT);
  return {
    key: String((json && json.data && json.data.qrcode) || ""),
    image: String((json && json.data && json.data.qrcode_img) || ""),
  };
}

async function loginQrCheck(input) {
  var params = Object.assign({}, defaults(), { plat: "4", appid: APPID, srcappid: SRCAPPID, qrcode: input.key });
  var json = await getJson("https://login-user.kugou.com/v2/get_userinfo_qrcode", params, WEB_SALT);
  var data = (json && json.data) || {};
  return {
    status: Number(data.status || 0),
    token: data.token ? String(data.token) : null,
    userid: data.userid ? String(data.userid) : null,
    nickname: data.nickname ? String(data.nickname) : null,
  };
}

// --- playlists ------------------------------------------------------------
async function playlists(input) {
  var params = Object.assign({}, defaults(), {
    dfid: input.dfid || "-",
    token: input.token,
    userid: input.userid,
    plat: "1",
  });
  var data = { userid: input.userid, token: input.token, total_ver: 979, type: 2, page: 1, pagesize: 100 };
  var json = await postJson("https://gateway.kugou.com/v7/get_all_list", params, data, "cloudlist.service.kugou.com");
  if (json && json.status !== undefined && Number(json.status) !== 1) {
    throw new Error("get_all_list failed: status=" + json.status);
  }
  if (json && json.error_code !== undefined && Number(json.error_code) !== 0) {
    throw new Error("get_all_list failed: error_code=" + json.error_code);
  }
  var info = (json && json.data && json.data.info) || [];
  return info.map(function (item) {
    return { name: String(item.name || ""), listid: Number(item.listid || 0), count: Number(item.count || 0) };
  });
}

async function addTrack(input) {
  var track = input.track || {};
  var clienttime = String(Math.floor(Date.now() / 1000));
  var params = Object.assign({}, defaults(), {
    dfid: input.dfid || "-",
    token: input.token,
    userid: input.userid,
    last_time: clienttime,
    last_area: "gztx",
  });
  var data = {
    userid: input.userid,
    token: input.token,
    listid: input.listid,
    list_ver: 0,
    type: 0,
    slow_upload: 1,
    scene: "false;null",
    data: [{
      number: 1,
      name: track.name,
      hash: track.hash,
      size: 0,
      sort: 0,
      timelen: 0,
      bitrate: 0,
      album_id: Number(track.albumId || 0),
      mixsongid: Number(track.mixSongId || 0),
    }],
  };
  var json = await postJson("https://gateway.kugou.com/cloudlist.service/v6/add_song", params, data);
  return { status: Number((json && json.status) || 0), msg: (json && (json.error || json.msg)) || null };
}


// --- AES-128-CBC, in JS ------------------------------------------------
// WebKit gives a plain WebView page no `crypto.subtle` (it is only there in a
// secure context), so the playlist's delete protocol cannot use WebCrypto.
// This is the same AES the Node port calls, computed by hand.
var SBOX = null;
var RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function gmul(a, b) {
  var p = 0;
  for (var i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    var hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function buildSbox() {
  if (SBOX) return SBOX;
  var table = new Array(256);
  for (var i = 0; i < 256; i++) {
    // i^-1 in GF(2^8), then the affine transform: the standard S-box.
    var inv = 0;
    if (i !== 0) {
      var pow = 1, base = i, exp = 254;
      while (exp > 0) {
        if (exp & 1) pow = gmul(pow, base);
        base = gmul(base, base);
        exp >>= 1;
      }
      inv = pow;
    }
    var r = inv, acc = inv;
    for (var k = 0; k < 4; k++) {
      r = ((r << 1) | (r >>> 7)) & 0xff;
      acc ^= r;
    }
    table[i] = acc ^ 0x63;
  }
  SBOX = table;
  return table;
}

function expandKey(key) {
  var sbox = buildSbox();
  var w = new Array(44);
  for (var i = 0; i < 4; i++) {
    w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
  }
  for (var i2 = 4; i2 < 44; i2++) {
    var temp = w[i2 - 1].slice();
    if (i2 % 4 === 0) {
      temp.push(temp.shift());
      for (var t2 = 0; t2 < 4; t2++) temp[t2] = sbox[temp[t2]];
      temp[0] ^= RCON[(i2 / 4) - 1];
    }
    w[i2] = [w[i2 - 4][0] ^ temp[0], w[i2 - 4][1] ^ temp[1], w[i2 - 4][2] ^ temp[2], w[i2 - 4][3] ^ temp[3]];
  }
  return w;
}

function addRoundKey(state, w, round) {
  for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) state[r][c] ^= w[round * 4 + c][r];
}

function encryptBlock(input, w) {
  var sbox = buildSbox();
  var state = [[], [], [], []];
  for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) state[r][c] = input[c * 4 + r];
  addRoundKey(state, w, 0);
  for (var round = 1; round <= 10; round++) {
    for (var r2 = 0; r2 < 4; r2++) for (var c2 = 0; c2 < 4; c2++) state[r2][c2] = sbox[state[r2][c2]];
    for (var r3 = 1; r3 < 4; r3++) {
      var row = state[r3].slice();
      for (var c3 = 0; c3 < 4; c3++) state[r3][c3] = row[(c3 + r3) % 4];
    }
    if (round !== 10) {
      for (var c4 = 0; c4 < 4; c4++) {
        var a0 = state[0][c4], a1 = state[1][c4], a2 = state[2][c4], a3 = state[3][c4];
        state[0][c4] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3;
        state[1][c4] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3;
        state[2][c4] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3);
        state[3][c4] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2);
      }
    }
    addRoundKey(state, w, round);
  }
  var out = new Uint8Array(16);
  for (var c5 = 0; c5 < 4; c5++) for (var r4 = 0; r4 < 4; r4++) out[c5 * 4 + r4] = state[r4][c5];
  return out;
}

function decryptBlock(input, w) {
  var sbox = buildSbox();
  var inv = new Array(256);
  for (var i = 0; i < 256; i++) inv[sbox[i]] = i;
  var state = [[], [], [], []];
  for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) state[r][c] = input[c * 4 + r];
  addRoundKey(state, w, 10);
  for (var round = 9; round >= 0; round--) {
    for (var r3 = 1; r3 < 4; r3++) {
      var row = state[r3].slice();
      for (var c3 = 0; c3 < 4; c3++) state[r3][c3] = row[(c3 - r3 + 4) % 4];
    }
    for (var r2 = 0; r2 < 4; r2++) for (var c2 = 0; c2 < 4; c2++) state[r2][c2] = inv[state[r2][c2]];
    addRoundKey(state, w, round);
    if (round !== 0) {
      for (var c4 = 0; c4 < 4; c4++) {
        var a0 = state[0][c4], a1 = state[1][c4], a2 = state[2][c4], a3 = state[3][c4];
        state[0][c4] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
        state[1][c4] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
        state[2][c4] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
        state[3][c4] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
      }
    }
  }
  var out = new Uint8Array(16);
  for (var c5 = 0; c5 < 4; c5++) for (var r4 = 0; r4 < 4; r4++) out[c5 * 4 + r4] = state[r4][c5];
  return out;
}

function aesCbcEncrypt(plain, key, iv) {
  var w = expandKey(key);
  var pad = 16 - (plain.length % 16);
  var data = new Uint8Array(plain.length + pad);
  data.set(plain, 0);
  for (var i = 0; i < pad; i++) data[plain.length + i] = pad;
  var out = new Uint8Array(data.length);
  var prev = iv;
  for (var off = 0; off < data.length; off += 16) {
    var block = new Uint8Array(16);
    for (var j = 0; j < 16; j++) block[j] = data[off + j] ^ prev[j];
    block = encryptBlock(block, w);
    out.set(block, off);
    prev = block;
  }
  return out;
}

function aesCbcDecrypt(cipher, key, iv) {
  var w = expandKey(key);
  var out = new Uint8Array(cipher.length);
  var prev = iv;
  for (var off = 0; off < cipher.length; off += 16) {
    var block = cipher.subarray(off, off + 16);
    var plain = decryptBlock(block, w);
    for (var j = 0; j < 16; j++) out[off + j] = plain[j] ^ prev[j];
    prev = block;
  }
  var pad = out[out.length - 1];
  if (pad < 1 || pad > 16) throw new Error("AES: bad padding");
  return out.subarray(0, out.length - pad);
}


// --- playlist create / delete (AES + RSA) ---------------------------------
function aesKeyIv(aes) {
  var h = md5(aes);
  return { key: utf8(h.substring(0, 16)), iv: utf8(h.substring(16, 32)) };
}

async function aesEncryptB64(data, aes) {
  var parts = aesKeyIv(aes);
  var plain = utf8(typeof data === "string" ? data : JSON.stringify(data));
  return bytesToB64(aesCbcEncrypt(plain, parts.key, parts.iv));
}

async function aesDecryptB64(b64, aes) {
  var parts = aesKeyIv(aes);
  var dec = aesCbcDecrypt(b64ToBytes(b64), parts.key, parts.iv);
  var text = new TextDecoder().decode(dec);
  try { return JSON.parse(text); } catch (e) { return text; }
}

function randomAesKey() {
  var chars = "1234567890abcdefghijklmnopqrstuvwxyz";
  var bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  var out = "";
  for (var i = 0; i < 6; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function readLen(buf, p) {
  var first = buf[p.i++];
  if (first < 0x80) return first;
  var n = first & 0x7f;
  var len = 0;
  for (var j = 0; j < n; j++) len = (len << 8) | buf[p.i++];
  return len;
}

function readTlv(buf, p) {
  var tag = buf[p.i++];
  var len = readLen(buf, p);
  var value = buf.subarray(p.i, p.i + len);
  p.i += len;
  return { tag: tag, value: value };
}

function parseRsaPublicKey() {
  var der = b64ToBytes(KUGOU_PUBLIC_KEY_B64);
  var p1 = { i: 0 };
  var outer = readTlv(der, p1).value;
  var p2 = { i: 0 };
  readTlv(outer, p2);
  var bit = readTlv(outer, p2).value;
  var p3 = { i: 1 };
  var seq = readTlv(bit, p3).value;
  var p4 = { i: 0 };
  var nBuf = readTlv(seq, p4).value;
  var eBuf = readTlv(seq, p4).value;
  var n = BigInt("0x" + bytesToHex(nBuf));
  var e = BigInt("0x" + bytesToHex(eBuf));
  return { n: n, e: e, size: Math.ceil(n.toString(2).length / 8) };
}

function modPow(base, exp, mod) {
  var result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function rsaEncryptPkcs1(message, fixedPaddingHex, nHex, eHex) {
  var parsed = nHex ? null : parseRsaPublicKey();
  var n = nHex ? BigInt("0x" + nHex) : parsed.n;
  var e = eHex ? BigInt("0x" + eHex) : parsed.e;
  var k = nHex ? Math.ceil(nHex.length / 2) : parsed.size;
  var m = utf8(message);
  var psLen = k - m.length - 3;
  if (psLen < 8) throw new Error("RSA message too long");
  var ps;
  if (fixedPaddingHex) {
    ps = hexToBytes(fixedPaddingHex);
    if (ps.length !== psLen) throw new Error("KAT padding must be " + psLen + " bytes");
  } else {
    ps = new Uint8Array(psLen);
    crypto.getRandomValues(ps);
    for (var i = 0; i < ps.length; i++) if (ps[i] === 0) ps[i] = 1;
  }
  for (var i2 = 0; i2 < ps.length; i2++) if (ps[i2] === 0) throw new Error("RSA PS must not contain zero bytes");
  var em = new Uint8Array(k);
  em[0] = 0;
  em[1] = 2;
  for (var i3 = 0; i3 < psLen; i3++) em[2 + i3] = ps[i3];
  em[2 + psLen] = 0;
  em.set(m, 3 + psLen);
  var c = modPow(BigInt("0x" + bytesToHex(em)), e, n);
  return c.toString(16).padStart(k * 2, "0").toUpperCase();
}

async function createPlaylist(input) {
  var clienttime = String(Math.floor(Date.now() / 1000));
  var params = Object.assign({}, defaults(), {
    dfid: input.dfid || "-", token: input.token, userid: input.userid, clienttime: clienttime,
    appid: APPID, clientver: CLIENTVER, last_time: clienttime, last_area: "gztx",
  });
  var data = {
    userid: input.userid, token: input.token, total_ver: 0, name: input.name, type: 0, source: 1,
    is_pri: 0, list_create_gid: "", from_shupinmv: 0,
  };
  var body = JSON.stringify(data);
  var signed = Object.assign({}, params, { signature: signatureWithBody(params, ANDROID_SALT, body) });
  var headers = {
    "User-Agent": ANDROID_UA, "Content-Type": "application/json;charset=utf-8",
    dfid: signed.dfid || "-", mid: signed.mid, clienttime: signed.clienttime,
    "kg-rc": "1", "kg-thash": "5d816a0", "kg-rec": "1", "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
  };
  var json = await http({ url: GATEWAY + "/cloudlist.service/v5/add_list?" + query(signed), method: "POST", headers: headers, body: body });
  if (Number(json && json.status) !== 1) throw new Error("add_list failed: " + JSON.stringify(json));
  var d = (json && json.data) || {};
  var info = d.info || {};
  var newId = Number(info.listid || info.list_create_listid || d.listid || d.list_create_listid || 0);
  if (!newId) throw new Error("add_list returned no listid: " + JSON.stringify(json));
  return newId;
}

async function parseDeleteResponse(text, aes) {
  try { return JSON.parse(text); } catch (e) { /* not plain JSON */ }
  var b64 = /^[A-Za-z0-9+/\s=]+$/.test(text) ? text.trim() : text;
  return await aesDecryptB64(b64, aes);
}

async function deletePlaylist(input) {
  var clienttime = String(Math.floor(Date.now() / 1000));
  var aes = randomAesKey();
  var body = await aesEncryptB64({ listid: Number(input.listid), total_ver: 0, type: 1 }, aes);
  var p = rsaEncryptPkcs1(JSON.stringify({ aes: aes, uid: input.userid, token: input.token }));
  var params = Object.assign({}, defaults(), {
    dfid: input.dfid || "-", token: input.token, userid: input.userid, clienttime: clienttime,
    appid: APPID, clientver: CLIENTVER, key: signParamsKey(clienttime),
    last_area: "gztx", last_time: clienttime, p: p,
  });
  var signed = Object.assign({}, params, { signature: signatureWithBody(params, ANDROID_SALT, body) });
  var headers = {
    "User-Agent": ANDROID_UA, dfid: signed.dfid || "-", mid: signed.mid, clienttime: signed.clienttime,
    "kg-rc": "1", "kg-thash": "5d816a0", "kg-rec": "1", "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
    "x-router": "cloudlist.service.kugou.com",
  };
  var text;
  try {
    text = await http({ url: GATEWAY + "/v2/delete_list?" + query(signed), method: "POST", headers: headers, body: body, as: "base64" });
  } catch (e) {
    var err = new Error("delete_list 请求失败：" + String((e && e.message) || e));
    err.unknownResult = true;
    throw err;
  }
  var json;
  try {
    json = await parseDeleteResponse(new TextDecoder().decode(b64ToBytes(text)), aes);
  } catch (e) {
    var err2 = new Error("delete_list 响应不可解析：" + String((e && e.message) || e));
    err2.unknownResult = true;
    throw err2;
  }
  if (Number(json && json.status) !== 1) throw new Error("delete_list failed: " + JSON.stringify(json));
}

async function resolvePlaylist(input) {
  var name = String(input.name || "").trim();
  if (!name) throw new Error("playlist name is empty");
  var all = await playlists(input);
  var found = null;
  for (var i = 0; i < all.length; i++) if (all[i].name.trim() === name) found = all[i];
  if (found && found.listid) return { listid: Number(found.listid), created: false };
  var listid = await createPlaylist(Object.assign({}, input, { name: name }));
  return { listid: listid, created: true };
}

async function clearPlaylist(input) {
  var name = String(input.name || "").trim();
  if (!name) throw new Error("playlist name is empty");
  var byName = null;
  try {
    var all = await playlists(input);
    for (var i = 0; i < all.length; i++) if (all[i].name.trim() === name) byName = all[i];
  } catch (e) {
    throw new Error("歌单列表查询失败，未执行清理：" + String((e && e.message) || e));
  }
  var oldId = byName && (!input.currentId || byName.listid === input.currentId) ? Number(byName.listid) : 0;
  if (!oldId) {
    var listid = await createPlaylist(Object.assign({}, input, { name: name }));
    return { listid: listid, deleted: false, warning: "未找到同名旧歌单（或名称与 id 不一致），未删除旧歌单" };
  }
  try {
    await deletePlaylist(Object.assign({}, input, { listid: oldId }));
  } catch (e) {
    if (e && e.unknownResult) {
      var err = new Error("旧歌单删除状态未知，未创建新歌单：" + String(e.message || e));
      err.deletedOld = true;
      err.deletedId = oldId;
      throw err;
    }
    throw new Error("旧歌单删除失败，未创建新歌单：" + String((e && e.message) || e));
  }
  try {
    var fresh = await createPlaylist(Object.assign({}, input, { name: name }));
  } catch (e) {
    var err2 = new Error("旧歌单已删除但重建失败：" + String((e && e.message) || e));
    err2.deletedOld = true;
    err2.deletedId = oldId;
    throw err2;
  }
  return { listid: fresh, deleted: true, deletedId: oldId };
}

// --- what the app calls ---------------------------------------------------
plugin.define({
  search: search,
  loginQrKey: loginQrKey,
  loginQrCheck: loginQrCheck,
  playlists: playlists,
  addTrack: addTrack,
  resolvePlaylist: resolvePlaylist,
  clearPlaylist: clearPlaylist,
  // Known-answer values: the Node KAT (scripts/kat-kugou-plugin.mjs) computes
  // the same numbers independently, so a wrong port fails here first.
  selftest: async function () {
    var aes = "a1b2c3";
    var aesB64 = await aesEncryptB64({ listid: 29, total_ver: 0, type: 1 }, aes);
    var msg = JSON.stringify({ aes: aes, uid: "123456", token: "TESTTOKEN" });
    var parsed = parseRsaPublicKey();
    var psLen = parsed.size - utf8(msg).length - 3;
    var padding = "01".repeat(psLen);
    return {
      md5: md5("abc"),
      md5Utf8: md5("酷狗音乐 123"),
      signParamsKey: signParamsKey("1700000000"),
      aesB64: aesB64,
      rsaHex: rsaEncryptPkcs1(msg, padding),
      rsaSize: parsed.size,
    };
  },
});
