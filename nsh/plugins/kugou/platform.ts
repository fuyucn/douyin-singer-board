// Registers the KuGou platform with the app. Everything the board needs is in
// this folder (`index.ts` search/login, `playlistOps.ts`, `playlistCrypto.ts`);
// `sqliteReader.ts` is the one-off reader the legacy import uses.
import { registerPlatform } from "../../src/platform/registry";

registerPlatform({
  id: "kugou",
  name: "酷狗音乐",
  short: "酷狗",
  version: "内置 v0.1.0",
  note: "登录、歌单、搜索、自动同步",
  playlist: true,
});
