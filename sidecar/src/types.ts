import { z } from 'zod';

export const ConfigSchema = z.object({
  room_id: z.string(),
  sing_prefix: z.string(),
  sing_cd: z.number(),
  fans_level: z.number(),
  blacklist: z.array(z.string()).optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

export const DanmuInfoSchema = z.object({
  msg_id: z.string(),
  uid: z.string(),
  uname: z.string(),
  song_name: z.string(),
  raw_msg: z.string(),
  medal_level: z.number(),
  medal_name: z.string(),
  send_time: z.number(),
});
export type DanmuInfo = z.infer<typeof DanmuInfoSchema>;

export const SidecarCmdSchema = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('start'), config: ConfigSchema }),
  z.object({ cmd: z.literal('stop') }),
  z.object({ cmd: z.literal('reload_config'), config: ConfigSchema }),
  z.object({ cmd: z.literal('kugou_start'), port: z.number().int().positive() }),
  z.object({ cmd: z.literal('kugou_stop') }),
]);
export type SidecarCmd = z.infer<typeof SidecarCmdSchema>;

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
