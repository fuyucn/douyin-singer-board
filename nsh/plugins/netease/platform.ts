// Netease is listed so the picker shows what is planned, but it has no module
// of its own yet: `playlist: false` keeps every playlist, sync and matching
// entry hidden while it is selected.
import { registerPlatform } from "../../src/platform/registry";

registerPlatform({
  id: "netease",
  name: "网易云音乐",
  short: "网易云",
  version: "未接入",
  note: "启用后歌单与歌曲匹配暂不可用",
  playlist: false,
});
