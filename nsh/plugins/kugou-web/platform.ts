// The KuGou platform's entry in the picker. Its API is not compiled in: the
// board talks to the plugin (`plugins/kugou-web/`) over the channel, so this
// file only says what the platform is called and that it has playlists.
import { registerPlatform } from "../../src/platform/registry";

registerPlatform({
  id: "kugou-web",
  name: "酷狗音乐",
  short: "酷狗",
  version: "插件 v0.1.1",
  note: "登录、歌单、搜索、自动同步",
  playlist: true,
});
