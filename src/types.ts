import { z } from 'zod';

export const DanmuInfoSchema = z.object({
  msg_id: z.string(),
  uid: z.string(),
  uname: z.string(),
  song_name: z.string(),
  raw_msg: z.string(),
  medal_level: z.number(),
  medal_name: z.string(),
  send_time: z.number(),
  played_at: z.number().optional(),
});
export type DanmuInfo = z.infer<typeof DanmuInfoSchema>;

export interface Config {
  room_id: string;
  sing_prefix: string;
  sing_cd: number;
  fans_level: number;
  cooldown_seconds: number;
  /** Per-user per-session auto-request limit. 0 = unlimited. Manual adds bypass it. */
  max_songs_per_user: number;
  target_playlist_name: string;
  target_playlist_id: number;
  /** When false, Kugou services and UI are fully disabled. */
  kugou_enabled: boolean;
}

export const SidecarEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('status'), connected: z.boolean(), message: z.string().optional() }),
  z.object({ event: z.literal('danmu'), data: DanmuInfoSchema }),
  z.object({ event: z.literal('cancel'), uid: z.string() }),
  z.object({
    event: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    msg: z.string(),
  }),
  z.object({ event: z.literal('error'), msg: z.string() }),
  z.object({ event: z.literal('crashed') }),
]);
export type SidecarEvent = z.infer<typeof SidecarEventSchema>;

// Human-friendly template, not a regex.
// Placeholders: [space] = whitespace, [song] = song-name capture.
export const DEFAULT_SING_PREFIX = '点歌[space][song]';

export const DEFAULT_ROOM_ID = '767116735823';
