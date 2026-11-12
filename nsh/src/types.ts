export const DEFAULT_SING_PREFIX = "点歌[space][song]";

export interface Config {
  room_id: string;
  sing_prefix: string;
  fans_level: number;
  sing_cd: number;
  cooldown_seconds: number;
  max_songs_per_user: number;
  target_playlist_name: string;
  target_playlist_id: number;
  kugou_enabled: boolean;
  blacklist?: string[];
  blacklist_singers?: string[];
  blacklist_meta?: Record<string, number>;
  auto_sync?: boolean;
  active_plugin?: string;
  config_version?: number;
}

export interface DanmuInfo {
  msg_id: string;
  uid: string;
  uname: string;
  song_name: string;
  raw_msg: string;
  medal_level: number;
  medal_name: string;
  send_time: number;
}

/** A track a platform matched for a request: `key` is what the platform
 *  dedupes by (KuGou's hash), `ref` its own payload for adding it. */
export interface Track {
  name: string;
  artist: string;
  key: string;
  ref?: unknown;
  duration?: number;
}

/** One playlist as a platform reports it. */
export interface Playlist {
  name: string;
  listid: number;
  count: number;
}
