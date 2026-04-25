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

export interface Config {
  room_id: string;
  sing_prefix: string;
  sing_cd: number;
  fans_level: number;
}

export type SidecarEvent =
  | { event: 'status'; connected: boolean; message?: string }
  | { event: 'danmu'; data: DanmuInfo }
  | { event: 'cancel'; uid: string }
  | { event: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; msg: string }
  | { event: 'error'; msg: string };

export const DEFAULT_SING_PREFIX = '^点歌\\s+(.+)';
