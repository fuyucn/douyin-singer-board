import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { DanmuInfo } from '../types';

interface Step {
  key: string;
  label: string;
  status: 'pending' | 'done';
}

interface Props {
  songs: DanmuInfo[];
  played: DanmuInfo[];
  running: boolean;
  steps: Step[];
}

const STEPS_FADE_DELAY = 1500;

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

export function SessionStats({ songs, played, running, steps }: Props) {
  // Tick every second for elapsed time
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  // Steps visibility: show while any pending; keep visible briefly after all-done, then hide.
  const doneAll = steps.every((s) => s.status === 'done');
  const [stepsVisible, setStepsVisible] = useState(!doneAll);
  const prevDoneAll = useRef(doneAll);
  useEffect(() => {
    if (doneAll && !prevDoneAll.current) {
      setStepsVisible(true);
      const t = window.setTimeout(() => setStepsVisible(false), STEPS_FADE_DELAY);
      return () => window.clearTimeout(t);
    } else if (!doneAll) {
      setStepsVisible(true);
    }
    prevDoneAll.current = doneAll;
  }, [doneAll]);

  const total = songs.length + played.length;
  const showStats = total > 0 || running;
  if (!showStats && !stepsVisible) return null;

  const allSongs = [...songs, ...played];
  const earliest = allSongs.reduce((min, s) => Math.min(min, s.send_time), Number.MAX_SAFE_INTEGER);
  const elapsed = earliest === Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, now - earliest);

  const avgProcessing =
    played.length === 0
      ? 0
      : played.reduce((sum, p) => sum + Math.max(0, (p.played_at ?? 0) - p.send_time), 0) /
        played.length;

  return (
    <div className="border-border-soft text-fg-muted flex items-center gap-4 border-t px-5 py-1.5 text-xs">
      {/* Live session stats (left side) */}
      {showStats && (
        <>
          <Stat label="队列" value={String(songs.length)} />
          <Stat label="已播" value={String(played.length)} />
          <Stat label="总数" value={String(total)} />
          {avgProcessing > 0 && <Stat label="平均处理" value={formatShort(avgProcessing)} />}
          {elapsed > 0 && <Stat label="时长" value={formatDuration(elapsed)} />}
        </>
      )}

      {/* Startup checklist (right side) — visible while pending or briefly after all done */}
      {stepsVisible && (
        <div className="ml-auto flex items-center gap-4">
          {steps.map((s) => (
            <span
              key={s.key}
              className={cn(
                'inline-flex items-center gap-1',
                s.status === 'done' ? 'text-success' : 'text-fg-faint',
              )}
            >
              {s.status === 'done' ? (
                <span className="text-[11px]">✓</span>
              ) : (
                <span className="bg-fg-faint inline-block size-2 rounded-full" />
              )}
              {s.label}
            </span>
          ))}
        </div>
      )}
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
