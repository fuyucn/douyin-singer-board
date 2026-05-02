import { Trash2 } from 'lucide-react';

interface LogEntry {
  text: string;
  level?: 'info' | 'success' | 'warning' | 'error';
}

function parseLogLevel(log: string): LogEntry {
  if (log.includes('[error]') || log.includes('失败') || log.includes('Error')) {
    return { text: log, level: 'error' };
  }
  if (log.includes('成功') || log.includes('已连接') || log.includes('done')) {
    return { text: log, level: 'success' };
  }
  if (log.includes('未连接') || log.includes('Warning') || log.includes('warn')) {
    return { text: log, level: 'warning' };
  }
  return { text: log, level: 'info' };
}

interface Props {
  logs: string[];
  onClear?: () => void;
}

const levelDot: Record<string, string> = {
  success: 'bg-green-500',
  info: 'bg-blue-500',
  warning: 'bg-yellow-400',
  error: 'bg-red-400',
};

function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function LogPanel({ logs, onClear }: Props) {
  if (logs.length === 0) return null;

  // Show last 8 log lines in the panel
  const recent = logs.slice(-8);

  return (
    <details className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elev)] text-xs overflow-hidden">
      <summary className="logs-summary flex cursor-pointer select-none list-none items-center justify-between px-4 py-2 text-[var(--fg-base)] hover:bg-[var(--bg-softer)]">
        <span className="font-medium">日志</span>
        <div className="flex items-center gap-2">
          <span className="text-[var(--fg-faint)]">{logs.length} 条</span>
          {onClear && (
            <button
              className="flex items-center gap-1 text-[var(--fg-faint)] hover:text-[var(--danger)] transition-colors"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }}
            >
              <Trash2 className="size-3" />
              清空日志
            </button>
          )}
        </div>
      </summary>
      <div className="border-t border-[var(--border-soft)] divide-y divide-[var(--border-softer)] max-h-[180px] overflow-y-auto">
        {recent.map((log, i) => {
          const entry = parseLogLevel(log);
          const dotClass = levelDot[entry.level ?? 'info'];
          return (
            <div key={i} className="flex items-start gap-3 px-4 py-1.5 text-[var(--fg-muted)]">
              <span className="shrink-0 font-mono text-[var(--fg-faint)] text-[10px] mt-0.5 w-14">
                {formatTimestamp()}
              </span>
              <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dotClass}`} />
              <span className="min-w-0 break-all leading-relaxed">{log}</span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
