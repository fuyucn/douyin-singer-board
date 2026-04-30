interface Props {
  items: string[];
  onRemove: (name: string) => void;
}

export function BlacklistPanel({ items, onRemove }: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex px-5 py-2 bg-bg-soft border-b border-border-medium text-xs text-fg-muted font-medium uppercase tracking-wide sticky top-0 z-10">
        <div className="w-36 shrink-0" />
        <div className="flex-1">黑名单歌曲</div>
        <div className="w-48 text-right">操作</div>
      </div>
      <div className="flex-1 overflow-y-auto bg-bg-base">
        {items.length === 0 && (
          <div className="py-10 text-center text-fg-faint">黑名单为空，右键点歌列表可添加</div>
        )}
        {items.map((name) => (
          <div key={name} className="flex items-center px-5 py-[10px] border-b border-border-softer hover:bg-bg-softer group">
            <div className="w-36 shrink-0" />
            <div className="flex-1 text-[15px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">{name}</div>
            <div className="w-48 flex justify-end gap-1.5">
              <button
                className="px-2.5 py-1 text-xs border border-border-strong rounded-[3px] bg-bg-elev text-fg-base cursor-pointer hover:bg-bg-soft"
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
