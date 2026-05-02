import { Trash2, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SongList } from './SongList';
import { BlacklistPanel } from './BlacklistPanel';
import { LogPanel } from './LogPanel';
import type { DanmuInfo } from '../types';
import type { KuGouEntry } from '../kugouSession';
interface Props {
  songs: DanmuInfo[];
  played: DanmuInfo[];
  blacklist: Set<string>;
  running: boolean;
  kugouLoggedIn: boolean;
  kugouCache: Record<string, KuGouEntry>;
  logs: string[];
  activeTab: 'songs' | 'played' | 'blacklist';
  onTabChange: (tab: 'songs' | 'played' | 'blacklist') => void;
  onClearList: () => void;
  onClearPlayed: () => void;
  onContextMenu: (e: React.MouseEvent, song: DanmuInfo) => void;
  renderSongActions: (s: DanmuInfo) => React.ReactNode;
  renderPlayedActions: (s: DanmuInfo) => React.ReactNode;
  onRemoveBlacklist: (name: string) => void;
}

export function MainContent({
  songs,
  played,
  blacklist,
  running,
  kugouCache,
  logs,
  activeTab,
  onTabChange,
  onClearList,
  onClearPlayed,
  onContextMenu,
  renderSongActions,
  renderPlayedActions,
  onRemoveBlacklist,
}: Props) {
  const tabDefs = [
    { key: 'songs' as const, label: `点歌列表 (${songs.length})` },
    { key: 'played' as const, label: `已点歌单 (${played.length})` },
    { key: 'blacklist' as const, label: `黑名单 (${blacklist.size})` },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top tab area */}
      <div className="flex-1 overflow-hidden border border-[var(--border-soft)] rounded-lg m-3 mb-2 flex flex-col bg-[var(--bg-elev)]">
        <Tabs
          value={activeTab}
          onValueChange={(v) => onTabChange(v as 'songs' | 'played' | 'blacklist')}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-0 shrink-0">
            <TabsList className="h-9 bg-transparent gap-0 p-0 border-b-0">
              {tabDefs.map((t) => (
                <TabsTrigger
                  key={t.key}
                  value={t.key}
                  className="rounded-none border-b-2 border-transparent px-4 py-2 text-sm data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:text-blue-500 data-[state=active]:shadow-none text-[var(--fg-muted)] hover:text-[var(--fg-base)]"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {activeTab === 'songs' && songs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-[var(--fg-muted)] hover:text-[var(--danger)]"
                onClick={onClearList}
              >
                <Trash2 className="size-3.5" />
                清空列表
              </Button>
            )}
            {activeTab === 'played' && played.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-[var(--fg-muted)] hover:text-[var(--danger)]"
                onClick={onClearPlayed}
              >
                <Trash2 className="size-3.5" />
                清空列表
              </Button>
            )}
          </div>

          {/* Column header */}
          {(activeTab === 'songs' || activeTab === 'played') && (
            <div className="border-b border-[var(--border-soft)] px-5 py-2 text-xs font-medium text-[var(--fg-muted)] flex shrink-0">
              <div className="w-8 shrink-0 text-center">#</div>
              <div className="w-32 shrink-0 ml-2">用户</div>
              <div className="flex-1">点歌</div>
              <div className="w-20 shrink-0 text-center">时间</div>
              <div className="w-32 text-right">操作</div>
            </div>
          )}

          <TabsContent value="songs" className="flex-1 min-h-0 m-0 overflow-hidden">
            {songs.length === 0 ? (
              <EmptyState running={running} />
            ) : (
              <SongList
                songs={songs}
                emptyText={running ? '等待点歌...' : '点击 "开始" 连接直播间'}
                showHeader={false}
                renderActions={renderSongActions}
                renderSong={(s) => {
                  const entry = kugouCache[s.song_name.trim()];
                  return (
                    <div className="song-cell">
                      <div className="song-original">{s.song_name}</div>
                      {entry?.status === 'found' ? (
                        <div className="song-match">{entry.track.filename}</div>
                      ) : entry?.status === 'pending' ? (
                        <div className="song-status">⋯ 搜索中</div>
                      ) : entry?.status === 'not_found' ? (
                        <div className="song-status">未找到</div>
                      ) : (
                        <div className="song-status">搜索失败</div>
                      )}
                    </div>
                  );
                }}
                onContextMenu={onContextMenu}
              />
            )}
          </TabsContent>

          <TabsContent value="played" className="flex-1 min-h-0 m-0 overflow-hidden">
            <SongList
              songs={played}
              emptyText="暂无已点歌曲"
              showHeader={false}
              renderActions={renderPlayedActions}
              renderUname={(s) => {
                const ts = s.played_at ?? s.send_time;
                const d = new Date(ts * 1000);
                const pad = (n: number) => String(n).padStart(2, '0');
                return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
              }}
              renderSong={(s) => {
                const entry = kugouCache[s.song_name.trim()];
                return (
                  <div className="song-cell">
                    <div className="song-original">{s.song_name}</div>
                    {entry?.status === 'found' ? (
                      <div className="song-match">{entry.track.filename}</div>
                    ) : null}
                  </div>
                );
              }}
              onContextMenu={onContextMenu}
            />
          </TabsContent>

          <TabsContent value="blacklist" className="flex-1 min-h-0 m-0 overflow-hidden">
            <BlacklistPanel items={Array.from(blacklist)} onRemove={onRemoveBlacklist} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Log panel */}
      <div className="shrink-0 mx-3 mb-3">
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}

function EmptyState({ running }: { running: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-[var(--fg-faint)]">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-[var(--bg-soft)]">
        <Music className="size-8 text-[var(--fg-faint)]" />
      </div>
      <div className="text-center">
        <div className="font-medium text-[var(--fg-muted)]">
          {running ? '等待点歌...' : '当前点歌列表为空'}
        </div>
        <div className="mt-1 text-xs">
          {running ? '正在监听直播间弹幕' : '观众点歌后会显示在这里'}
        </div>
      </div>
    </div>
  );
}


