import { expect, test } from "nsh/test";
import { Matcher } from "./matcher";

const config = {
  room_id: "",
  sing_prefix: "点歌[space][song]",
  fans_level: 0,
  sing_cd: 0,
  cooldown_seconds: 1800,
  max_songs_per_user: 3,
  target_playlist_name: "",
  target_playlist_id: 0,
  kugou_enabled: false,
};

test("matches the default template", () => {
  const m = new Matcher(config);
  const r = m.match({ uid: "u1", uname: "小苏", content: "点歌 晴天", medal_level: 0, medal_name: "" });
  expect(r.kind).toBe("song");
  if (r.kind === "song") expect(r.danmu.song_name).toBe("晴天");
});

test("rejects a missing prefix", () => {
  const m = new Matcher(config);
  const r = m.match({ uid: "u1", uname: "小苏", content: "晴天", medal_level: 0, medal_name: "" });
  expect(r.kind).toBe("skip");
});

test("fans level filter and cancel", () => {
  const m = new Matcher({ ...config, fans_level: 5 });
  const low = m.match({ uid: "u1", uname: "小苏", content: "点歌 晴天", medal_level: 2, medal_name: "团" });
  expect(low.kind).toBe("skip");
  const cancel = m.match({ uid: "u1", uname: "小苏", content: "取消点歌", medal_level: 0, medal_name: "" });
  expect(cancel.kind).toBe("cancel");
});
