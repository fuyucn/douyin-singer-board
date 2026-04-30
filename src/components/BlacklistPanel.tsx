interface Props {
  items: string[];
  onRemove: (name: string) => void;
}

export function BlacklistPanel({ items, onRemove }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="bg-bg-soft border-border-medium text-fg-muted sticky top-0 z-10 flex border-b px-5 py-2 text-xs font-medium tracking-wide uppercase">
        <div className="w-36 shrink-0" />
        <div className="flex-1">黑名单歌曲</div>
        <div className="w-48 text-right">操作</div>
      </div>
      <div className="bg-bg-base flex-1 overflow-y-auto">
        {items.length === 0 && (
          <div className="text-fg-faint py-10 text-center">黑名单为空，右键点歌列表可添加</div>
        )}
        {items.map((name) => (
          <div
            key={name}
            className="border-border-softer hover:bg-bg-softer group flex items-center border-b px-5 py-[10px]"
          >
            <div className="w-36 shrink-0" />
            <div className="flex-1 overflow-hidden text-[15px] font-medium text-ellipsis whitespace-nowrap">
              {name}
            </div>
            <div className="flex w-48 justify-end gap-1.5">
              <button
                className="border-border-strong bg-bg-elev text-fg-base hover:bg-bg-soft cursor-pointer rounded-[3px] border px-2.5 py-1 text-xs"
                onClick={() => onRemove(name)}
              >
                移除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
