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

export async function qrCheck(key: string): Promise<{ status: number; token?: string; userid?: string }> {
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
  };
}
