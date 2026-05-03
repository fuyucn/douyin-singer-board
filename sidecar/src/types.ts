export interface Config {
  room_id: string;
  sing_prefix: string;
  sing_cd: number;
  fans_level: number;
  blacklist?: string[];
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

export type SidecarCmd =
  | { cmd: 'start'; config: Config }
  | { cmd: 'stop' }
  | { cmd: 'reload_config'; config: Config }
  | { cmd: 'set_companion_pid'; pid: number };

export type SidecarEvent =
  | { event: 'status'; connected: boolean; message?: string }
  | { event: 'danmu'; data: DanmuInfo }
  | { event: 'cancel'; uid: string }
  | { event: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; msg: string }
  | { event: 'error'; msg: string };

// Human-friendly template, not a regex.
// Placeholders: [space] = one or more whitespace, [song] = song-name capture.
// Legacy [空格]/[歌曲]/[歌名] still accepted for backward compatibility.
// matcher.templateToRegex turns this into /^点歌\s+(.+?)$/
export const DEFAULT_SING_PREFIX = '点歌[space][song]';
