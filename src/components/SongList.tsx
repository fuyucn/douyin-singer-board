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

export function SongList({ songs, emptyText, showHeader = true, headerLabels, renderActions, renderUname, renderSong, onContextMenu }: Props) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {showHeader && (
        <div className="flex px-5 py-2 bg-bg-soft border-b border-border-medium text-xs text-fg-muted font-medium uppercase tracking-wide sticky top-0 z-10">
          <div className="w-36 shrink-0">{headerLabels?.uname ?? '用户'}</div>
          <div className="flex-1">{headerLabels?.song ?? '点歌'}</div>
          <div className="w-48 text-right">{headerLabels?.actions ?? '操作'}</div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto bg-bg-base">
        {songs.length === 0 && (
          <div className="py-10 text-center text-fg-faint">{emptyText}</div>
        )}
        {songs.map((s) => (
          <div
            key={s.msg_id}
            className="flex items-center px-5 py-[10px] border-b border-border-softer hover:bg-bg-softer group"
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, s) : undefined}
          >
            <div className="w-36 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg-muted text-[13px]">
              {renderUname ? renderUname(s) : s.uname}
            </div>
            <div className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {renderSong ? renderSong(s) : <span className="text-[15px] font-medium">{s.song_name}</span>}
            </div>
            <div className="w-48 flex justify-end gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
              {renderActions(s)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
