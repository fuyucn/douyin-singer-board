import type { Config } from '../types';
import type { ToastKind } from '../hooks/useToast';
import { resolvePlaylistByName } from '../kugouSession';
import { saveConfig } from '../db';

interface Props {
  config: Config;
  onConfigChange: (patch: Partial<Config>) => void;
  autoSync: boolean;
  onAutoSyncToggle: () => void;
  showToast: (msg: string, kind?: ToastKind) => void;
}

const inputCls =
  'py-1.5 px-2.5 border border-border-strong rounded bg-bg-base text-fg-base disabled:bg-bg-disabled disabled:text-fg-faint';

export function KugouPlaylistSection({
  config,
  onConfigChange,
  autoSync,
  onAutoSyncToggle,
  showToast,
}: Props) {
  return (
    <section className="border-border-soft bg-bg-elev flex items-center gap-2 border-b px-5 py-3">
      <span className="text-fg-muted shrink-0 text-xs">Kugou歌单</span>
      <input
        className={`${inputCls} min-w-0 flex-1`}
        type="text"
        value={config.target_playlist_name}
        onChange={(e) => onConfigChange({ target_playlist_name: e.target.value })}
        placeholder="自动加入歌单的名字"
      />
      <span className="text-fg-muted font-mono text-xs whitespace-nowrap">
        {config.target_playlist_id ? `id: ${config.target_playlist_id}` : 'id: —'}
      </span>
      <button
        type="button"
        className="bg-accent hover:bg-accent-hover shrink-0 cursor-pointer rounded border-none px-3.5 py-1.5 text-[13px] text-white"
        onClick={async () => {
          const name = config.target_playlist_name.trim();
          if (!name) {
            showToast('请先填歌单名', 'error');
            return;
          }
          try {
            const { listid, created } = await resolvePlaylistByName(name);
            onConfigChange({ target_playlist_id: listid });
            await saveConfig({
              ...config,
              target_playlist_name: name,
              target_playlist_id: listid,
            });
            showToast(created ? `已新建歌单 (id: ${listid})` : `已绑定歌单 (id: ${listid})`);
          } catch (e) {
            const detail = String(e);
            showToast(
              detail.includes('not logged in') ? '请先点酷狗图标扫码登录' : `解析失败: ${detail}`,
              'error',
            );
          }
        }}
      >
        保存
      </button>
      {config.target_playlist_id > 0 && (
        <button
          type="button"
          className={['auto-sync-btn', autoSync && 'active'].filter(Boolean).join(' ')}
          onClick={onAutoSyncToggle}
          title={autoSync ? '自动歌单同步中' : '自动歌单同步'}
        >
          {autoSync ? '自动歌单同步中' : '自动歌单同步'}
        </button>
      )}
    </section>
  );
}
