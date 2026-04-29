import type { DanmuInfo } from '../types';

interface Props {
  songs: DanmuInfo[];
  emptyText: string;
  showHeader?: boolean;
  headerLabels?: { uname: string; song: string; actions: string };
  renderActions: (song: DanmuInfo) => React.ReactNode;
  renderUname?: (song: DanmuInfo) => string;
  renderSongName?: (song: DanmuInfo) => string;
  onContextMenu?: (e: React.MouseEvent, song: DanmuInfo) => void;
}

export function SongList({ songs, emptyText, showHeader = true, headerLabels, renderActions, renderUname, renderSongName, onContextMenu }: Props) {
  return (
    <div className="list">
      {showHeader && (
        <div className="list-header">
          <div className="col-uname">{headerLabels?.uname ?? '用户'}</div>
          <div className="col-song">{headerLabels?.song ?? '点歌'}</div>
          <div className="col-actions">{headerLabels?.actions ?? '操作'}</div>
        </div>
      )}
      <div className="list-body">
        {songs.length === 0 && <div className="empty">{emptyText}</div>}
        {songs.map((s) => (
          <div key={s.msg_id} className="item" onContextMenu={onContextMenu ? (e) => onContextMenu(e, s) : undefined}>
            <div className="col-uname uname">{renderUname ? renderUname(s) : s.uname}</div>
            <div className="col-song song">{renderSongName ? renderSongName(s) : s.song_name}</div>
            <div className="col-actions item-actions">
              {renderActions(s)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
