import { useEffect, useState } from 'react';
import type { DanmuInfo } from '../types';

interface Props {
  songs: DanmuInfo[];
  played: DanmuInfo[];
  running: boolean;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}秒`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}分${Math.floor(seconds % 60)}秒`;
  const hours = Math.floor(mins / 60);
  return `${hours}时${mins % 60}分`;
}

function formatShort(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  const mins = Math.floor(seconds / 60);
  return `${mins}分${Math.round(seconds % 60)}秒`;
}

export function SessionStats({ songs, played, running }: Props) {
  // Tick every second for elapsed time
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const total = songs.length + played.length;
  if (total === 0 && !running) return null;

  // Earliest song to compute session elapsed
  const allSongs = [...songs, ...played];
  const earliest = allSongs.reduce(
    (min, s) => Math.min(min, s.send_time),
    Number.MAX_SAFE_INTEGER,
  );
  const elapsed = earliest === Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, now - earliest);

  // Average processing time: from request → added to playlist
  const avgProcessing =
    played.length === 0
      ? 0
      : played.reduce((sum, p) => sum + Math.max(0, (p.played_at ?? 0) - p.send_time), 0) /
        played.length;

  return (
    <div className="border-border-soft text-fg-muted flex items-center gap-4 border-t px-5 py-1.5 text-xs">
      <Stat label="队列" value={String(songs.length)} />
      <Stat label="已播" value={String(played.length)} />
      <Stat label="总数" value={String(total)} />
      {avgProcessing > 0 && (
        <Stat label="平均处理" value={formatShort(avgProcessing)} />
      )}
      {elapsed > 0 && <Stat label="时长" value={formatDuration(elapsed)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-fg-faint">{label}</span>
      <span className="text-fg-base tabular-nums">{value}</span>
    </span>
  );
}
