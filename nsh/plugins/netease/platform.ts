// NetEase Cloud Music's entry in the picker. Like KuGou, its API is not
// compiled in: the board talks to plugins/netease-web over the channel.
import { registerPlatform } from "../../src/platform/registry";

registerPlatform({
  id: "netease-web",
  name: "网易云音乐",
  short: "网易云",
  version: "插件 v0.1.0",
  note: "登录（Cookie）、歌单、搜索、自动同步",
  playlist: true,
});
