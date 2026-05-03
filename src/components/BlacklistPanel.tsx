import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { X, ShieldOff, Plus } from 'lucide-react';

export interface BlacklistItemUI {
  id: number;
  entryType: 'song' | 'singer';
  songName: string;
  singerName: string;
  createdAt: number;
}

interface Props {
  items: BlacklistItemUI[];
  onRemove: (id: number) => void;
  onAddSinger: (singerName: string) => void;
}

const ROW_HEIGHT = 40;

export function BlacklistPanel({ items, onRemove, onAddSinger }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const handleAdd = () => {
    const name = input.trim();
    if (!name) return;
    onAddSinger(name);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  const addBar = (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--bg-soft)] px-4 py-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入歌手名…"
        className="h-7 flex-1 rounded border border-[var(--border-soft)] bg-[var(--bg-base)] px-2 text-xs text-[var(--fg-base)] outline-none placeholder:text-[var(--fg-faint)] focus:border-[var(--accent)]"
      />
      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 gap-1 text-xs"
        disabled={!input.trim()}
        onClick={handleAdd}
      >
        <Plus className="size-3" />
        添加歌手
      </Button>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {addBar}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--fg-faint)]">
          <ShieldOff className="size-8 opacity-30" />
          <p className="text-sm">黑名单为空</p>
          <p className="text-xs">右键点歌列表可添加歌曲/歌手</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {addBar}

      {/* Header */}
      <div className="flex shrink-0 border-b border-[var(--border-soft)] bg-[var(--bg-soft)] px-4 py-2 text-xs font-medium text-[var(--fg-muted)]">
        <div className="w-12">类型</div>
        <div className="flex-1">歌曲名</div>
        <div className="w-28">歌手</div>
        <div className="w-24 text-right">添加时间</div>
        <div className="w-10" />
      </div>

      {/* Virtual list */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const { id, entryType, songName, singerName, createdAt } = items[vRow.index];
            const d = new Date(createdAt * 1000);
            const pad = (n: number) => String(n).padStart(2, '0');
            const dateStr = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            return (
              <div
                key={id}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                className="group absolute top-0 left-0 flex w-full items-center border-b border-[var(--border-softer)] px-4 transition-colors hover:bg-[var(--bg-softer)]"
                style={{ transform: `translateY(${vRow.start}px)`, height: ROW_HEIGHT }}
              >
                <span className="w-12 shrink-0">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      entryType === 'singer'
                        ? 'bg-purple-500/10 text-purple-400'
                        : 'bg-blue-500/10 text-blue-400'
                    }`}
                  >
                    {entryType === 'singer' ? '歌手' : '歌曲'}
                  </span>
                </span>
                <span className="flex-1 truncate text-sm text-[var(--fg-base)]">
                  {entryType === 'singer' ? '全部歌曲' : songName}
                </span>
                <span className="w-28 truncate text-xs text-[var(--fg-muted)]">
                  {singerName || '—'}
                </span>
                <span className="w-24 text-right text-xs text-[var(--fg-faint)]">{dateStr}</span>
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-[var(--fg-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
                      onClick={() => onRemove(id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs">
                    移出黑名单
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
