import { expect, test } from "nsh/test";
import {
  SyncLedger,
  formatDuration,
  isAuthFailure,
  nextDelay,
  pickNextSync,
  type SearchState,
  type TrackLike,
} from "./autoSync";
import type { DanmuInfo } from "./types";

const song = (id: string, name: string): DanmuInfo => ({
  msg_id: id,
  uid: `u${id}`,
  uname: `user${id}`,
  song_name: name,
  raw_msg: name,
  medal_level: 0,
  medal_name: "",
  send_time: 1000,
});

const track: TrackLike = { name: "晴天", artist: "周杰伦", hash: "ABCD" };
const cache: Record<string, SearchState | undefined> = { 晴天: { status: "found", track } };

test("ledger claims once and never re-adds a synced song", () => {
  const l = new SyncLedger(() => 0);
  expect(l.claim("a")).toBe(true);
  expect(l.claim("a")).toBe(false);
  l.synced("a", track.hash ?? "");
  expect(l.phase("a")).toBe("synced");
  expect(l.claim("a")).toBe(false);
});

test("manual takeover stops a late worker result from moving the row", () => {
  const l = new SyncLedger(() => 0);
  expect(l.claim("a")).toBe(true);
  expect(l.claim("a")).toBe(false);
  l.manual("a");
  l.synced("a", track.hash ?? "");
  expect(l.phase("a")).toBe("manual");
  expect(l.claim("a")).toBe(false);
});

test("failed attempts retry only after their backoff", () => {
  let now = 0;
  const l = new SyncLedger(() => now);
  expect(l.claim("a")).toBe(true);
  l.failed("a", "network", 10);
  expect(l.canAttempt("a")).toBe(false);
  now = 9;
  expect(l.canAttempt("a")).toBe(false);
  now = 11;
  expect(l.canAttempt("a")).toBe(true);
});

test("abortInFlight holds ownership until a late result lands", () => {
  let now = 0;
  const l = new SyncLedger(() => now);
  l.claim("a");
  l.synced("b", track.hash ?? "");
  l.abortInFlight();
  expect(l.phase("a")).toBe("aborted");
  expect(l.canAttempt("a")).toBe(false);
  expect(l.claim("a")).toBe(false);
  l.synced("a", track.hash ?? "");
  expect(l.phase("a")).toBe("synced");
  expect(l.claim("a")).toBe(false);
  // A response that never arrives is eventually abandoned and retried.
  l.claim("c");
  l.abortInFlight();
  now = 121;
  expect(l.canAttempt("c")).toBe(true);
});

test("a failed late result releases an aborted write for retry", () => {
  let now = 0;
  const l = new SyncLedger(() => now);
  l.claim("a");
  l.abortInFlight();
  l.failed("a", "network", 5);
  expect(l.phase("a")).toBe("failed");
  expect(l.canAttempt("a")).toBe(false);
  now = 6;
  expect(l.canAttempt("a")).toBe(true);
});

test("pickNextSync skips blocked, over-limit, cooling, missing and owned songs", () => {
  const l = new SyncLedger(() => 0);
  const songs = [song("1", "被挡"), song("2", "超限"), song("3", "冷却"), song("4", "没搜到"), song("5", "晴天")];
  const full: Record<string, SearchState | undefined> = {
    ...cache,
    被挡: { status: "found", track: { ...track, artist: "被封歌手" } },
    超限: { status: "found", track },
    冷却: { status: "found", track },
    没搜到: { status: "not_found" },
  };
  const opts = {
    cache: full,
    ledger: l,
    blocked: (t: TrackLike) => (t.artist === "被封歌手" ? "singer" : null),
    overLimit: (s: DanmuInfo) => s.msg_id === "2",
    coolingDown: (name: string) => name === "冷却",
  };
  const first = pickNextSync(songs, opts);
  expect(first?.key).toBe("5");
  expect(l.claim("5")).toBe(true);
  expect(pickNextSync(songs, opts)).toBe(null);
});

test("backoff is bounded and idle jitter stays in 3-5s", () => {
  expect(nextDelay(0, () => 0)).toBe(3000);
  expect(nextDelay(0, () => 1)).toBe(5000);
  expect(nextDelay(1)).toBe(5000);
  expect(nextDelay(2)).toBe(10000);
  expect(nextDelay(9)).toBe(60000);
});

test("auth failures are detected, successes are not", () => {
  expect(isAuthFailure({ status: 1 })).toBe(false);
  expect(isAuthFailure({ status: 0, msg: "token expired" })).toBe(true);
  expect(isAuthFailure({ status: 0, msg: "登录失效" })).toBe(true);
  expect(isAuthFailure({ status: 0, msg: "error 401" })).toBe(true);
  expect(isAuthFailure({ status: 0, msg: "playlist full" })).toBe(false);
});

test("duration formatting", () => {
  expect(formatDuration(0)).toBe("0秒");
  expect(formatDuration(59)).toBe("59秒");
  expect(formatDuration(125)).toBe("2分5秒");
  expect(formatDuration(3725)).toBe("1时2分");
});
