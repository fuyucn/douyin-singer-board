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
  auto_sync?: boolean;
  active_plugin?: "kugou" | "netease" | "";
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
