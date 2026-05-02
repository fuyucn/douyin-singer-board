import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

const levelDot: Record<string, string> = {
  success: 'bg-green-500',
  info: 'bg-blue-400',
  warning: 'bg-yellow-400',
  error: 'bg-red-400',
};

function parseLevel(log: string): string {
  if (log.includes('[error]') || log.includes('失败') || log.includes('Error')) return 'error';
  if (log.includes('成功') || log.includes('已连接') || log.includes('done')) return 'success';
  if (log.includes('未连接') || log.includes('Warning') || log.includes('warn')) return 'warning';
  return 'info';
}

// Extract or generate a timestamp string from the log line.
// Logs from sidecar often start with "[HH:MM:SS]" or similar.
function extractTime(log: string): string {
  const m = log.match(/\b(\d{2}:\d{2}:\d{2})\b/);
  return m ? m[1] : '';
}

interface Props {
  logs: string[];
  onClear?: () => void;
}

const ROW_HEIGHT = 28;

export function LogPanel({ logs, onClear }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (logs.length === 0) return null;

  return (
    <details className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elev)] text-xs">
      <summary className="logs-summary flex cursor-pointer select-none list-none items-center justify-between px-4 py-2 text-[var(--fg-base)] hover:bg-[var(--bg-softer)]">
        <span className="font-medium">日志</span>
        <div className="flex items-center gap-2">
          <span className="text-[var(--fg-faint)]">{logs.length} 条</span>
          {onClear && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1 text-xs text-[var(--fg-faint)] hover:text-red-500"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }}
            >
              <Trash2 className="size-3" />
              清空
            </Button>
          )}
        </div>
      </summary>

      {/* Virtual scrollable log body */}
      <div
        ref={bodyRef}
        className="max-h-[200px] overflow-y-auto border-t border-[var(--border-soft)]"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const log = logs[vRow.index];
            const level = parseLevel(log);
            const time = extractTime(log);
            return (
              <div
                key={vRow.index}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 flex w-full items-start gap-2 border-b border-[var(--border-softer)] px-4 py-1 text-[var(--fg-muted)] select-text cursor-text"
                style={{ transform: `translateY(${vRow.start}px)` }}
              >
                {time && (
                  <span className="mt-0.5 w-14 shrink-0 font-mono text-[10px] text-[var(--fg-faint)]">
                    {time}
                  </span>
                )}
                <span className={`mt-[5px] size-1.5 shrink-0 rounded-full ${levelDot[level]}`} />
                <span className="min-w-0 break-all leading-relaxed">{log}</span>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
