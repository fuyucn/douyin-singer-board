// Kugou 插件适配器：直连酷狗 API，不需要 Node / express。
// 迁移自 kugou-slim 的 login_qr_key / login_qr_check / search。
import { createHash } from "crypto";

const APPID = "1005";
const CLIENTVER = "20489";
const SRCAPPID = "2919";
const ANDROID_SALT = "OIlwieks28dk2k092lksi2UIkp";
const WEB_SALT = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const MID = String(Math.floor(Math.random() * 9_000_000_000_000_000) + 1_000_000_000_000_000);

export type Track = {
  name: string;
  artist: string;
  hash: string;
  albumId: string;
  mixSongId: string;
  duration: number;
};

function md5(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

function signature(params: Record<string, string>, salt: string): string {
  const body = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");
  return md5(`${salt}${body}${salt}`);
}

function defaults(): Record<string, string> {
  return {
    dfid: "-",
    mid: MID,
    uuid: "-",
    appid: APPID,
    clientver: CLIENTVER,
    clienttime: String(Math.floor(Date.now() / 1000)),
  };
}

async function getJson(
  base: string,
  params: Record<string, string>,
  salt: string,
  router?: string,
): Promise<any> {
  const signed = { ...params, signature: signature(params, salt) };
  const query = Object.keys(signed)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(signed[key])}`)
    .join("&");
  const headers: Record<string, string> = {
    "User-Agent": UA,
    dfid: params.dfid ?? "-",
    mid: params.mid ?? MID,
    clienttime: params.clienttime ?? String(Math.floor(Date.now() / 1000)),
  };
  if (router) headers["x-router"] = router;
  const response = await fetch(`${base}?${query}`, { headers });
  return response.json();
}

export async function search(input: { keyword: string; page?: number; pagesize?: number }): Promise<Track[]> {
  const params = {
    ...defaults(),
    keyword: input.keyword,
    page: String(input.page ?? 1),
    pagesize: String(input.pagesize ?? 10),
    platform: "AndroidFilter",
    iscorrection: "1",
    privilegefilter: "0",
    area_code: "1",
    dopicfull: "1",
  };
  const json = await getJson("https://gateway.kugou.com/v2/search/song", params, ANDROID_SALT, "complexsearch.kugou.com");
  const lists = json?.data?.lists ?? [];
  return lists.map((item: any) => ({
    name: String(item.SongName ?? ""),
    artist: String(item.SingerName ?? ""),
    hash: String(item.FileHash ?? ""),
    albumId: String(item.AlbumID ?? ""),
    mixSongId: String(item.MixSongID ?? ""),
    duration: Number(item.Duration ?? 0),
  }));
}

export async function qrKey(): Promise<{ key: string; image: string }> {
  const params = {
    ...defaults(),
    appid: "1001",
    type: "1",
    plat: "4",
    srcappid: SRCAPPID,
    qrcode_txt: "https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1001&",
  };
  const json = await getJson("https://login-user.kugou.com/v2/qrcode", params, WEB_SALT);
  return {
    key: String(json?.data?.qrcode ?? ""),
    image: String(json?.data?.qrcode_img ?? ""),
  };
}

export async function qrCheck(key: string): Promise<{ status: number; token?: string; userid?: string; nickname?: string }> {
  const params = {
    ...defaults(),
    plat: "4",
    appid: APPID,
    srcappid: SRCAPPID,
    qrcode: key,
  };
  const json = await getJson("https://login-user.kugou.com/v2/get_userinfo_qrcode", params, WEB_SALT);
  const data = json?.data ?? {};
  return {
    status: Number(data.status ?? 0),
    token: data.token ? String(data.token) : undefined,
    userid: data.userid ? String(data.userid) : undefined,
    nickname: data.nickname ? String(data.nickname) : undefined,
  };
}

// --- Logged-in playlist APIs -------------------------------------------------

const ANDROID_UA = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi";

function signatureWithBody(params: Record<string, string>, salt: string, body: string): string {
  const text = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");
  return md5(`${salt}${text}${body}${salt}`);
}

async function postJson(
  base: string,
  params: Record<string, string>,
  data: unknown,
  router?: string,
): Promise<any> {
  const body = JSON.stringify(data);
  const signed = { ...params, signature: signatureWithBody(params, ANDROID_SALT, body) };
  const query = Object.keys(signed)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(signed[key])}`)
    .join("&");
  const headers: Record<string, string> = {
    "User-Agent": ANDROID_UA,
    "Content-Type": "application/json",
    dfid: params.dfid ?? "-",
    mid: params.mid ?? MID,
    clienttime: params.clienttime ?? String(Math.floor(Date.now() / 1000)),
  };
  if (router) headers["x-router"] = router;
  const response = await fetch(`${base}?${query}`, { method: "POST", headers, body });
  return response.json();
}

export type Playlist = { name: string; listid: number; count: number };

export async function playlists(token: string, userid: string, dfid = "-"): Promise<Playlist[]> {
  const params = {
    ...defaults(),
    dfid,
    token,
    userid,
    plat: "1",
  };
  const data = {
    userid,
    token,
    total_ver: 979,
    type: 2,
    page: 1,
    pagesize: 30,
  };
  const json = await postJson("https://gateway.kugou.com/v7/get_all_list", params, data, "cloudlist.service.kugou.com");
  const info = json?.data?.info ?? [];
  return info.map((item: any) => ({
    name: String(item.name ?? ""),
    listid: Number(item.listid ?? 0),
    count: Number(item.count ?? 0),
  }));
}

export async function addTrack(
  token: string,
  userid: string,
  listid: number,
  track: Track,
  dfid = "-",
): Promise<{ status: number; msg?: string }> {
  const clienttime = String(Math.floor(Date.now() / 1000));
  const params = {
    ...defaults(),
    dfid,
    token,
    userid,
    last_time: clienttime,
    last_area: "gztx",
  };
  const data = {
    userid,
    token,
    listid,
    list_ver: 0,
    type: 0,
    slow_upload: 1,
    scene: "false;null",
    data: [
      {
        number: 1,
        name: track.name,
        hash: track.hash,
        size: 0,
        sort: 0,
        timelen: 0,
        bitrate: 0,
        album_id: Number(track.albumId || 0),
        mixsongid: Number(track.mixSongId || 0),
      },
    ],
  };
  const json = await postJson("https://gateway.kugou.com/cloudlist.service/v6/add_song", params, data);
  return { status: Number(json?.status ?? 0), msg: json?.error ?? json?.msg };
}
