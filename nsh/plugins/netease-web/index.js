// NetEase Cloud Music, as a plugin. Search/playlists go through the weapi
// protocol: AES-CBC twice (preset key, then a random key) and RSA for the key.
// Cookies are the session: the app's fetch keeps a cookie jar, so a MUSIC_U
// pasted once carries every later request; the plugin sends it explicitly too.
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
var BASE = "https://music.163.com";
var NONCE = "0CoJUm6Qyw8W8jud";
var IV = "0102030405060708";
var PUB_EXP = "010001";
var PUB_MOD = "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
var SECRET_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function utf8(text) { return new TextEncoder().encode(String(text)); }

function bytesToB64(bytes) {
  var text = "";
  for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

function bytesToHex(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return out;
}

function randomSecret() {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  var out = "";
  for (var i = 0; i < 16; i++) out += SECRET_CHARS[bytes[i] % SECRET_CHARS.length];
  return out;
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

// weapi signs with raw RSA ("NONE" padding): the reversed random key is the
// whole message, so no PKCS#1 block is built.
function rsaEncryptHex(message) {
  var n = BigInt("0x" + PUB_MOD);
  var e = BigInt("0x" + PUB_EXP);
  var k = Math.ceil(n.toString(2).length / 8);
  var c = modPow(BigInt("0x" + bytesToHex(utf8(message))), e, n);
  return c.toString(16).padStart(k * 2, "0");
}

function aesB64(text, key) {
  var parts = { key: utf8(key), iv: utf8(IV) };
  return bytesToB64(aesCbcEncrypt(utf8(text), parts.key, parts.iv));
}

function weapiData(data) {
  var text = JSON.stringify(data);
  var secret = randomSecret();
  // The server decrypts twice: the body is the first ciphertext (base64)
  // encrypted again with the random key.
  return {
    params: aesB64(aesB64(text, NONCE), secret),
    encSecKey: rsaEncryptHex(secret.split("").reverse().join("")),
  };
}

async function call(path, data, cookie) {
  var body = weapiData(data);
  var headers = {
    "User-Agent": UA,
    "Referer": BASE + "/",
    "Origin": BASE,
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": cookie || "os=pc; appver=2.9.7; channel=netease;",
  };
  return await app.call("http.json", {
    url: BASE + path,
    method: "POST",
    headers: headers,
    body: "params=" + encodeURIComponent(body.params) + "&encSecKey=" + encodeURIComponent(body.encSecKey),
  });
}

// A session is the cookie header itself (MUSIC_U=...; ...); cookies live in the
// app's jar too, but passing the header makes a restored session independent
// of what the jar kept between launches.
function cookieOf(input) {
  var token = String((input && input.token) || "");
  // `jar:` means "the app's cookie jar holds MUSIC_U after a scan"; only a
  // pasted MUSIC_U is sent as a header.
  return /^MUSIC_U=/.test(token) ? token : "";
}

async function account(cookie) {
  var json = await call("/weapi/w/nuser/account/get", {}, cookie);
  var profile = (json && json.profile) || null;
  if (!profile) throw new Error("登录状态无效：请重新粘贴 MUSIC_U");
  return { userid: String(profile.userId), nickname: String(profile.nickname || profile.userId) };
}

async function loginCookie(input) {
  var cookie = cookieOf(input).trim();
  if (!cookie || !/MUSIC_U=/.test(cookie)) throw new Error("Cookie 里没有 MUSIC_U");
  var who = await account(cookie);
  return { token: cookie, userid: who.userid, nickname: who.nickname, dfid: "-" };
}

async function loginQrKey() {
  var json = await app.call("http.json", {
    url: BASE + "/api/login/qrcode/unikey?type=1",
    method: "GET",
    headers: { "User-Agent": UA, "Referer": BASE + "/" },
  });
  var key = String((json && json.unikey) || "");
  if (!key) throw new Error("二维码生成失败");
  var target = "https://music.163.com/login?codekey=" + key + "&type=1";
  return {
    key: key,
    // The app needs an image; NetEase only returns the key.
    image: "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(target),
  };
}

async function loginQrCheck(input) {
  var json = await app.call("http.json", {
    // Cache-buster: the poll repeats the same URL and a cached 801 would hide
    // the transition to 802/803.
    url: BASE + "/api/login/qrcode/client/login?key=" + encodeURIComponent(input.key) + "&type=1&_t=" + Date.now(),
    method: "GET",
    headers: { "User-Agent": UA, "Referer": BASE + "/", "Cache-Control": "no-cache" },
  });
  var code = Number((json && json.code) || 0);

  var message = String((json && json.message) || "");
  if (code === 803) {
    try {
      var who = await account("");
      return { status: 4, token: "jar:", userid: who.userid, nickname: who.nickname };
    } catch (e) {
      // The cookie may still be settling; report success and let playlists
      // show whether it is usable.
      return { status: 4, token: "jar:", userid: "0", nickname: "网易云用户" };
    }
  }
  // NetEase has retired web QR login for this client: after the scan it
  // answers 8821 "请切换其他登录方式或升级新版本再试". Treat it as a final
  // refusal, not as "still waiting", so the panel can say why.
  if (code === 8821) {
    return { status: -1, code: code, message: message };
  }
  return { status: code === 802 ? 2 : code === 800 ? 0 : 1, code: code, message: message };
}

async function search(input) {
  var keyword = String(input.keyword || "").trim();
  if (!keyword) return [];
  var json = await call("/weapi/cloudsearch/pc", {
    s: keyword, type: 1, limit: Number(input.pagesize || 10),
    offset: Number(input.offset || 0), total: true,
  });
  var songs = (json && json.result && json.result.songs) || [];
  return songs.map(function (song) {
    return {
      name: String(song.name || ""),
      artist: (song.ar || []).map(function (a) { return a.name; }).join(" / "),
      key: String(song.id || ""),
      ref: "netease",
      duration: Math.round(Number(song.dt || 0) / 1000),
    };
  });
}

async function playlists(input) {
  var json = await call("/weapi/user/playlist", {
    uid: Number(input.userid), limit: 100, offset: 0, includeVideo: true,
  }, cookieOf(input));
  var list = (json && json.playlist) || [];
  return list.map(function (p) {
    return { name: String(p.name || ""), listid: Number(p.id || 0), count: Number(p.trackCount || 0) };
  });
}

async function createPlaylist(input, name) {
  var json = await call("/weapi/playlist/create", { name: name }, cookieOf(input));
  var id = json && json.id ? Number(json.id) : Number(json && json.playlist && json.playlist.id);
  if (!id) throw new Error("playlist/create failed: " + JSON.stringify(json));
  return id;
}

async function addTrack(input) {
  var track = input.track || {};
  var id = Number(track.key || 0);
  if (!id) return { status: 0, msg: "no song id: keys=" + Object.keys(track).join(",") + " key=" + String(track.key) };
  var json = await call("/weapi/playlist/manipulate/tracks", {
    op: "add", pid: String(input.listid), trackIds: "[" + id + "]",
  }, cookieOf(input));
  var ok = Number(json && (json.code || json.status)) === 200;
  return { status: ok ? 1 : 0, msg: ok ? null : String((json && (json.message || json.msg)) || "add failed") };
}

async function resolvePlaylist(input) {
  var name = String(input.name || "").trim();
  if (!name) throw new Error("playlist name is empty");
  var all = await playlists(input);
  var found = null;
  for (var i = 0; i < all.length; i++) if (all[i].name.trim() === name) found = all[i];
  if (found && found.listid) return { listid: found.listid, created: false };
  return { listid: await createPlaylist(input, name), created: true };
}

async function clearPlaylist(input) {
  var name = String(input.name || "").trim();
  if (!name) throw new Error("playlist name is empty");
  var all = await playlists(input);
  var sameName = [], bound = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i].name.trim() === name) sameName.push(all[i].listid);
    if (input.currentId && all[i].listid === Number(input.currentId)) bound = all[i];
  }
  if (input.currentId && (!bound || bound.name.trim() !== name)) {
    return { listid: Number(input.currentId), deleted: false, refused: true, warning: "名称与 id 不一致，未删除旧歌单" };
  }
  if (!sameName.length) {
    return { listid: await createPlaylist(input, name), deleted: false, warning: "未找到同名旧歌单，未删除旧歌单" };
  }
  for (var j = 0; j < sameName.length; j++) {
    var json = await call("/weapi/playlist/delete", { pid: String(sameName[j]) }, cookieOf(input));
    if (Number(json && json.code) !== 200) throw new Error("歌单删除失败: " + JSON.stringify(json));
  }
  return { listid: await createPlaylist(input, name), deleted: true, deletedId: sameName[0], deletedIds: sameName };
}

plugin.define({
  search: search,
  loginQrKey: loginQrKey,
  loginQrCheck: loginQrCheck,
  loginCookie: loginCookie,
  playlists: playlists,
  addTrack: addTrack,
  resolvePlaylist: resolvePlaylist,
  clearPlaylist: clearPlaylist,
});

