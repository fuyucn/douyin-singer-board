interface Props {
  manualText: string;
  onManualTextChange: (text: string) => void;
  onManualAdd: () => void;
  activeTab: 'songs' | 'played' | 'blacklist';
  displayCount: number;
  onCopyAll: () => void;
  onClearList: () => void;
}

const btnBase =
  'py-1.5 px-3.5 border border-border-strong rounded bg-bg-elev text-fg-base cursor-pointer hover:bg-bg-soft disabled:opacity-40 disabled:cursor-not-allowed';

export function ToolbarSection({
  manualText,
  onManualTextChange,
  onManualAdd,
  activeTab,
  displayCount,
  onCopyAll,
  onClearList,
}: Props) {
  return (
    <section className="border-border-soft bg-bg-elev flex gap-2 border-b px-5 py-3">
      <input
        className="border-border-strong bg-bg-base text-fg-base flex-1 rounded border px-2.5 py-1.5"
        type="text"
        placeholder="手动点歌"
        value={manualText}
        onChange={(e) => onManualTextChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onManualAdd()}
      />
      <button className={btnBase} onClick={onManualAdd}>
        添加
      </button>
      {activeTab === 'songs' ? (
        <>
          <button className={btnBase} onClick={onCopyAll} disabled={displayCount === 0}>
            复制列表 ({displayCount})
          </button>
          <button className={btnBase} onClick={onClearList} disabled={displayCount === 0}>
            清空
          </button>
        </>
      ) : (
        <span className="text-fg-muted self-center text-xs">
          {activeTab === 'played'
            ? '已点歌曲列表，当前 session 有效'
            : '黑名单中的歌曲不会被匹配到'}
        </span>
      )}
    </section>
  );
}
