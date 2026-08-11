import { useRef, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Trash2, Copy, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

// ─── Level config ────────────────────────────────────────────────────────────
// Each level keeps a small monospace badge with a muted status colour.

const LEVEL_CONFIG = {
  success: {
    badge: 'OK ',
    badgeClass: 'text-success',
  },
  info: {
    badge: 'INF',
    badgeClass: 'text-accent-soft-fg',
  },
  warning: {
    badge: 'WRN',
    badgeClass: 'text-amber-500',
  },
  error: {
    badge: 'ERR',
    badgeClass: 'text-danger-soft-fg',
  },
} as const;

type Level = keyof typeof LEVEL_CONFIG;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseLevel(log: string): Level {
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

function extractTime(log: string): string {
  const m = log.match(/\b(\d{2}:\d{2}:\d{2})\b/);
  return m ? m[1] : '';
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  logs: string[];
  onClear?: () => void;
}

const ROW_HEIGHT = 26;

// ─── Component ───────────────────────────────────────────────────────────────

export function LogPanel({ logs, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
      toast.success(`已复制 ${logs.length} 条日志`);
    } catch (e) {
      toast.error(`复制失败: ${e}`);
    }
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className="border-border-soft bg-bg-elev shrink-0 overflow-hidden border-t">
      {/* Header bar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          'bg-bg-soft flex w-full cursor-default items-center gap-2 px-3 py-[6px]',
          'select-none',
        ].join(' ')}
      >
        <span className="text-fg-muted text-[12px] font-medium">日志</span>

        <span className="bg-border-softer text-fg-faint ml-1 rounded px-1.5 py-0 font-mono text-[10px]">
          {logs.length}
        </span>

        <span className="flex-1" />

        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <TerminalBtn icon={<Copy className="size-3" />} label="复制" onClick={onCopy} />
          {onClear && (
            <TerminalBtn
              icon={<Trash2 className="size-3" />}
              label="清空"
              danger
              onClick={onClear}
            />
          )}
        </span>

        {/* Chevron indicator */}
        <ChevronDown
          className={[
            'text-fg-faint ml-1 size-3.5 transition-transform duration-200',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>

      <div
        className={[
          'grid transition-[grid-template-rows] duration-150 ease-in-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        ].join(' ')}
      >
        <div className="min-h-0 overflow-hidden">
          <div ref={bodyRef} className="bg-bg-base max-h-[220px] overflow-y-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((vRow) => {
                const log = logs[vRow.index];
                const level = parseLevel(log);
                const cfg = LEVEL_CONFIG[level];
                const time = extractTime(log);

                return (
                  <div
                    key={vRow.index}
                    data-index={vRow.index}
                    ref={virtualizer.measureElement}
                    className={[
                      'absolute top-0 left-0 w-full',
                      'flex items-baseline gap-0',
                      'border-b-border-softer border-b',
                      'hover:bg-bg-softer',
                      'cursor-text select-text',
                      'transition-colors duration-75',
                    ].join(' ')}
                    style={{ transform: `translateY(${vRow.start}px)`, minHeight: ROW_HEIGHT }}
                  >
                    <span className="text-fg-faint w-[58px] shrink-0 px-2 pt-[5px] text-right font-mono text-[10px] leading-none">
                      {time || '––:––:––'}
                    </span>

                    <span className="bg-border-softer mx-1 w-px shrink-0 self-stretch" />

                    <span
                      className={[
                        'w-[28px] shrink-0 pt-[5px] font-mono text-[10px] leading-none font-semibold select-none',
                        cfg.badgeClass,
                      ].join(' ')}
                    >
                      {cfg.badge}
                    </span>

                    <span className="bg-border-softer mx-1 w-px shrink-0 self-stretch" />

                    <span className="text-fg-muted min-w-0 flex-1 py-[5px] pr-3 text-[11px] leading-relaxed break-all">
                      {log.replace(/^\d{2}:\d{2}:\d{2}\s+/, '')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Inline helper: small log action button ─────────────────────────────────

function TerminalBtn({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex items-center gap-1 rounded px-1.5 py-0.5',
        'text-[11px] transition-colors duration-100',
        danger
          ? 'text-fg-faint hover:bg-danger-soft-bg hover:text-danger-soft-fg'
          : 'text-fg-faint hover:bg-border-softer hover:text-fg-base',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  );
}
