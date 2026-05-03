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
  // Demote known stderr noise to warning even if tagged [error]
  const isStderrNoise =
    log.includes('[stderr]') ||
    log.includes('DeprecationWarning') ||
    log.includes('decode tap setup failed') ||
    log.includes('dynamic import callback');

  if (isStderrNoise) return 'warning';

  if (log.includes('[error]') || log.includes('失败') || log.includes('process exited'))
    return 'error';
  if (
    log.includes('[warn]') ||
    log.includes('Warning') ||
    log.includes('warn') ||
    log.includes('未连接')
  )
    return 'warning';
  if (
    log.includes('成功') ||
    log.includes('已连接') ||
    log.includes('connected') ||
    log.includes('done')
  )
    return 'success';
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
    <details className="border-border-soft bg-bg-elev overflow-hidden rounded-lg border text-xs">
      <summary className="logs-summary text-fg-base hover:bg-bg-softer flex cursor-pointer list-none items-center justify-between px-4 py-1 select-none">
        <span className="font-medium">日志</span>
        <div className="flex items-center gap-2">
          <span className="text-fg-faint">{logs.length} 条</span>
          {onClear && (
            <Button
              variant="ghost"
              size="sm"
              className="text-fg-faint h-6 gap-1 px-1 text-xs hover:text-red-500"
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
      <div ref={bodyRef} className="border-border-soft max-h-[200px] overflow-y-auto border-t">
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
                className="border-border-softer text-fg-muted absolute top-0 left-0 flex w-full cursor-text items-start gap-2 border-b px-4 py-1 select-text"
                style={{ transform: `translateY(${vRow.start}px)` }}
              >
                {time && (
                  <span className="text-fg-faint mt-0.5 w-14 shrink-0 font-mono text-[10px]">
                    {time}
                  </span>
                )}
                <span className={`mt-[5px] size-1.5 shrink-0 rounded-full ${levelDot[level]}`} />
                <span className="min-w-0 leading-relaxed break-all">{log}</span>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
