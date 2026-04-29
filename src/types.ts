export interface DanmuInfo {
  msg_id: string;
  uid: string;
  uname: string;
  song_name: string;
  raw_msg: string;
  medal_level: number;
  medal_name: string;
  send_time: number;
  played_at?: number;
}

export interface Config {
  room_id: string;
  sing_prefix: string;
  sing_cd: number;
  fans_level: number;
  target_playlist_name: string;
  target_playlist_id: number;
}

export type SidecarEvent =
  | { event: 'status'; connected: boolean; message?: string }
  | { event: 'danmu'; data: DanmuInfo }
  | { event: 'cancel'; uid: string }
  | { event: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; msg: string }
  | { event: 'error'; msg: string };

// Human-friendly template, not a regex.
// Placeholders: [space] = whitespace, [song] = song-name capture.
export const DEFAULT_SING_PREFIX = '点歌[space][song]';
