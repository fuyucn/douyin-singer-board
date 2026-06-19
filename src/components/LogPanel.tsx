import { useRef, useState, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Trash2, Copy, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

// ─── Level config ────────────────────────────────────────────────────────────
// Each level gets: a coloured left-border accent, a subtle row tint,
// a monospace badge, and an ANSI-inspired text colour.

const LEVEL_CONFIG = {
  success: {
    badge: 'OK ',
    badgeClass: 'text-emerald-400',
    rowClass: 'hover:bg-emerald-500/5',
    barClass: 'border-l-emerald-500/70',
  },
  info: {
    badge: 'INF',
    badgeClass: 'text-blue-400',
    rowClass: 'hover:bg-blue-500/5',
    barClass: 'border-l-blue-500/50',
  },
  warning: {
    badge: 'WRN',
    badgeClass: 'text-amber-400',
    rowClass: 'hover:bg-amber-500/8',
    barClass: 'border-l-amber-400/70',
  },
  error: {
    badge: 'ERR',
    badgeClass: 'text-red-400',
    rowClass: 'hover:bg-red-500/8',
    barClass: 'border-l-red-500/70',
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
    /*
     * ① Terminal Card 外观
     * - 使用 bg-[var(--bg-elev)] 令卡片与周围内容产生层次感
     * - border + shadow-sm 增加质感
     * - overflow-hidden 确保内容不泄出圆角
     */
    <div className="border-border-soft bg-bg-elev overflow-hidden rounded-lg border shadow-sm">

      {/* ② Header bar — Terminal 风格 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          // 深色 header，与 body 拉开对比
          'bg-bg-soft/60 dark:bg-bg-softer/40',
          'flex w-full cursor-pointer items-center gap-2 px-3 py-[6px]',
          'select-none',
          // hover 反馈
          'hover:bg-bg-soft/80 transition-colors duration-100',
        ].join(' ')}
      >
        {/* 标题 */}
        <span className="font-mono text-[11px] text-fg-muted tracking-wider uppercase">
          logs
        </span>

        {/* count badge */}
        <span className="ml-1 rounded bg-border-softer px-1.5 py-0 font-mono text-[10px] text-fg-faint">
          {logs.length}
        </span>

        {/* spacer */}
        <span className="flex-1" />

        {/* Action buttons — stop propagation to avoid toggling open */}
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <TerminalBtn
            icon={<Copy className="size-3" />}
            label="复制"
            onClick={onCopy}
          />
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
            'ml-1 size-3.5 text-fg-faint transition-transform duration-200',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>

      {/*
       * ③ Animated body — grid-template-rows trick
       *    open:  grid-rows-[1fr]   → natural height (up to max-h)
       *    close: grid-rows-[0fr]   → height 0 (inner div min-h-0)
       * This avoids JS animation and works with Tailwind v4 arbitrary values.
       */}
      <div
        className={[
          'grid transition-[grid-template-rows] duration-200 ease-in-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        ].join(' ')}
      >
        <div className="min-h-0 overflow-hidden">
          {/*
           * ④ Virtual scroll body
           * border-t separates header from log lines
           */}
          <div
            ref={bodyRef}
            className="border-border-softer max-h-[220px] overflow-y-auto border-t"
            // Slightly darker bg for the "terminal screen" look
            style={{ background: 'oklch(from var(--bg-elev) calc(l - 0.015) c h)' }}
          >
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
                      /*
                       * ④ Enhanced log row
                       * - border-l-2: level accent bar (key visual diff from before)
                       * - hover tint: subtle level-coloured background
                       * - border-b-border-softer: ultra-faint divider
                       */
                      'absolute top-0 left-0 w-full',
                      'flex items-baseline gap-0',
                      'border-b border-b-border-softer border-l-2',
                      cfg.barClass,
                      cfg.rowClass,
                      'cursor-text select-text',
                      'transition-colors duration-75',
                    ].join(' ')}
                    style={{ transform: `translateY(${vRow.start}px)`, minHeight: ROW_HEIGHT }}
                  >
                    {/*
                     * ⑤ Timestamp column
                     * monospace, right-aligned, fixed width
                     */}
                    <span className="shrink-0 w-[58px] px-2 pt-[5px] font-mono text-[10px] text-fg-faint text-right leading-none">
                      {time || '––:––:––'}
                    </span>

                    {/* Thin vertical separator */}
                    <span className="shrink-0 self-stretch w-px bg-border-softer mx-1" />

                    {/* Level badge — monospace, fixed 3-char */}
                    <span
                      className={[
                        'shrink-0 w-[28px] pt-[5px] font-mono text-[10px] font-semibold leading-none select-none',
                        cfg.badgeClass,
                      ].join(' ')}
                    >
                      {cfg.badge}
                    </span>

                    {/* Thin vertical separator */}
                    <span className="shrink-0 self-stretch w-px bg-border-softer mx-1" />

                    {/* Log message — strip the leading timestamp (shown in the time column) */}
                    <span className="min-w-0 flex-1 py-[5px] pr-3 text-[11px] text-fg-muted leading-relaxed break-all">
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

// ─── Inline helper: small terminal-style icon button ─────────────────────────

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
        'font-mono text-[10px] transition-colors duration-100',
        danger
          ? 'text-fg-faint hover:text-red-400 hover:bg-red-500/10'
          : 'text-fg-faint hover:text-fg-muted hover:bg-border-softer',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  );
}
