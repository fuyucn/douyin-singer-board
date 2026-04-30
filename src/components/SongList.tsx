import type { DanmuInfo } from '../types';

interface Props {
  songs: DanmuInfo[];
  emptyText: string;
  showHeader?: boolean;
  headerLabels?: { uname: string; song: string; actions: string };
  renderActions: (song: DanmuInfo) => React.ReactNode;
  renderUname?: (song: DanmuInfo) => string;
  renderSong?: (song: DanmuInfo) => React.ReactNode;
  onContextMenu?: (e: React.MouseEvent, song: DanmuInfo) => void;
}

export function SongList({
  songs,
  emptyText,
  showHeader = true,
  headerLabels,
  renderActions,
  renderUname,
  renderSong,
  onContextMenu,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showHeader && (
        <div className="bg-bg-soft border-border-medium text-fg-muted sticky top-0 z-10 flex border-b px-5 py-2 text-xs font-medium tracking-wide uppercase">
          <div className="w-36 shrink-0">{headerLabels?.uname ?? '用户'}</div>
          <div className="flex-1">{headerLabels?.song ?? '点歌'}</div>
          <div className="w-48 text-right">{headerLabels?.actions ?? '操作'}</div>
        </div>
      )}
      <div className="bg-bg-base flex-1 overflow-y-auto">
        {songs.length === 0 && <div className="text-fg-faint py-10 text-center">{emptyText}</div>}
        {songs.map((s) => (
          <div
            key={s.msg_id}
            className="border-border-softer hover:bg-bg-softer group flex items-center border-b px-5 py-[10px]"
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, s) : undefined}
          >
            <div className="text-fg-muted w-36 shrink-0 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap">
              {renderUname ? renderUname(s) : s.uname}
            </div>
            <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {renderSong ? (
                renderSong(s)
              ) : (
                <span className="text-[15px] font-medium">{s.song_name}</span>
              )}
            </div>
            <div className="flex w-48 justify-end gap-1.5 opacity-70 transition-opacity group-hover:opacity-100">
              {renderActions(s)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
