// Playlist create/delete, ported from kugou-api/module/playlist_add.js and
// playlist_del.js. create uses the plain android-signed JSON path (same as
// add_song); delete needs the AES+RSA protocol in playlistCrypto.ts.
import { Buffer } from "buffer";
import { playlists, defaults, signatureWithBody } from "./index";
import {
  ANDROID_SALT, APPID, CLIENTVER, aesEncryptB64, aesDecryptB64,
  randomAesKey, rsaEncryptPkcs1, signParamsKey,
} from "./playlistCrypto";

const UA = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi";
const GATEWAY = "https://gateway.kugou.com";

function query(params: Record<string, string>): string {
  return Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
}

/** kugou-api/util/request.js injects these on every createRequest call. */
function headers(params: Record<string, string>, router?: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": UA,
    dfid: params.dfid ?? "-",
    mid: params.mid ?? "",
    clienttime: params.clienttime,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
  };
  if (router) h["x-router"] = router;
  return h;
}

/** The upstream answer is raw AES ciphertext. Some environments answer with
 *  plain JSON (and the test stubs do too); accept both. Exported so the
 *  production binary path can be unit-tested without a network. */
export async function parseDeleteResponse(bytes: Uint8Array, aes: string): Promise<any> {
  const text = Buffer.from(bytes).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    const b64 = /^[A-Za-z0-9+/\s=]+$/.test(text)
      ? text.trim()
      : Buffer.from(bytes).toString("base64");
    return aesDecryptB64(b64, aes);
  }
}

export async function createPlaylist(input: {
  token: string; userid: string; name: string; dfid?: string;
}): Promise<number> {
  const { token, userid, name } = input;
  const dfid = input.dfid || "-";
  const clienttime = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    ...defaults(), dfid, token, userid, clienttime,
    appid: APPID, clientver: CLIENTVER,
    last_time: clienttime, last_area: "gztx",
  };
  const data = {
    userid, token, total_ver: 0, name, type: 0, source: 1,
    is_pri: 0, list_create_gid: "", from_shupinmv: 0,
  };
  const body = JSON.stringify(data);
  const signed = { ...params, signature: signatureWithBody(params, ANDROID_SALT, body) };
  const res = await fetch(`${GATEWAY}/cloudlist.service/v5/add_list?${query(signed)}`, {
    method: "POST",
    headers: { ...headers(signed), "Content-Type": "application/json;charset=utf-8" },
    body,
  });
  const json: any = await res.json();
  if (Number(json?.status) !== 1) throw new Error(`add_list failed: ${JSON.stringify(json)}`);
  const d = json?.data ?? {};
  const info = d.info ?? {};
  const newId = Number(info.listid ?? info.list_create_listid ?? d.listid ?? d.list_create_listid ?? 0);
  if (!newId) throw new Error(`add_list returned no listid: ${JSON.stringify(json)}`);
  return newId;
}

export async function deletePlaylist(input: {
  token: string; userid: string; listid: number; dfid?: string;
}): Promise<void> {
  const { token, userid } = input;
  const dfid = input.dfid || "-";
  const clienttime = String(Math.floor(Date.now() / 1000));
  const aes = randomAesKey();
  const body = await aesEncryptB64(
    { listid: Number(input.listid), total_ver: 0, type: 1 },
    aes,
  );
  const p = rsaEncryptPkcs1(JSON.stringify({ aes, uid: userid, token }));
  const params: Record<string, string> = {
    ...defaults(), dfid, token, userid, clienttime,
    appid: APPID, clientver: CLIENTVER,
    key: signParamsKey(clienttime),
    last_area: "gztx", last_time: clienttime, p,
  };
  const signed = { ...params, signature: signatureWithBody(params, ANDROID_SALT, body) };
  let res: any;
  try {
    res = await fetch(`${GATEWAY}/v2/delete_list?${query(signed)}`, {
      method: "POST",
      headers: headers(signed, "cloudlist.service.kugou.com"),
      body,
    });
  } catch (e: any) {
    const err: any = new Error(`delete_list 请求失败：${String(e?.message ?? e)}`);
    err.unknownResult = true;
    throw err;
  }
  let json: any;
  try {
    json = await parseDeleteResponse(new Uint8Array(await res.arrayBuffer()), aes);
  } catch (e: any) {
    // No readable answer: the server may already have deleted the playlist.
    const err: any = new Error(`delete_list 响应不可解析：${String(e?.message ?? e)}`);
    err.unknownResult = true;
    throw err;
  }
  // An explicit non-1 status means the playlist was NOT deleted.
  if (Number(json?.status) !== 1) throw new Error(`delete_list failed: ${JSON.stringify(json)}`);
}

/** Original's resolvePlaylistByName: look up the editable name in the user's
 *  playlists; use it if it exists, otherwise create a fresh one. Returns the
 *  listid auto-sync should write into. Called ONCE when auto-sync is turned
 *  on (and when the name/id must be re-resolved), not on every render. */
export async function resolvePlaylistByName(input: {
  token: string; userid: string; name: string; dfid?: string;
}): Promise<{ listid: number; created: boolean }> {
  const name = input.name.trim();
  if (!name) throw new Error("playlist name is empty");
  const all = await playlists(input.token, input.userid, input.dfid ?? "-");
  const found = all.find((p) => p.name.trim() === name);
  if (found && found.listid) return { listid: Number(found.listid), created: false };
  const listid = await createPlaylist({ ...input, name });
  return { listid, created: true };
}

/** Original order: delete the named playlist FIRST, then create a fresh one
 *  under the same name and return its new listid. Safety rules kept:
 *  - delete ONLY the playlist whose name matches the editable name, never a
 *    stale target_playlist_id (editing the name must not destroy another list);
 *  - if delete fails, do not create anything and do not change the config;
 *  - if create fails after a successful delete, throw with deletedOld=true so
 *    the caller clears the dangling id instead of writing to a deleted list. */
export async function clearPlaylistByName(input: {
  token: string; userid: string; name: string; currentId: number; dfid?: string;
}): Promise<{ listid: number; deleted: boolean; deletedId?: number; warning?: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("playlist name is empty");
  let byName: { listid: number; name: string } | undefined;
  // A failed lookup is not "no such playlist": creating a new empty list here
  // would silently hide the user's real playlist.
  try {
    const all = await playlists(input.token, input.userid, input.dfid ?? "-");
    byName = all.find((p) => p.name.trim() === name);
  } catch (e: any) {
    throw new Error(`歌单列表查询失败，未执行清理：${String(e?.message ?? e)}`);
  }

  // A mismatch is almost always a renamed input or a stale id: deleting by id
  // would destroy the wrong playlist.
  const oldId = byName && (!input.currentId || byName.listid === input.currentId)
    ? Number(byName.listid) : 0;
  if (!oldId) {
    const listid = await createPlaylist({ ...input, name });
    return {
      listid, deleted: false,
      warning: "未找到同名旧歌单（或名称与 id 不一致），未删除旧歌单",
    };
  }

  // 1) delete
  try {
    await deletePlaylist({ ...input, listid: oldId });
  } catch (e: any) {
    if (e?.unknownResult) {
      // The write may have succeeded upstream but the answer was lost. Keep
      // the caller from writing into a possibly-deleted playlist.
      const err: any = new Error(`旧歌单删除状态未知，未创建新歌单：${String(e?.message ?? e)}`);
      err.deletedOld = true;
      err.deletedId = oldId;
      throw err;
    }
    throw new Error(`旧歌单删除失败，未创建新歌单：${String(e?.message ?? e)}`);
  }

  // 2) create, returning the NEW listid
  let listid: number;
  try {
    listid = await createPlaylist({ ...input, name });
  } catch (e: any) {
    const err: any = new Error(`旧歌单已删除但重建失败：${String(e?.message ?? e)}`);
    err.deletedOld = true;
    err.deletedId = oldId;
    throw err;
  }
  return { listid, deleted: true, deletedId: oldId };
}
