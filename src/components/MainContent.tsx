import { useMemo } from 'react';
import { useWindowWidth } from '@/hooks/useWindowWidth';
import { Trash2, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SongTable, songColumnHelper } from './SongTable';
import { BlacklistPanel, type BlacklistItemUI } from './BlacklistPanel';
import { LogPanel } from './LogPanel';
import type { DanmuInfo } from '../types';
import type { EnrichedEntry } from '../kugouSession';
import type { BlacklistItem } from '../store/logs';

interface Props {
  songs: DanmuInfo[];
  played: DanmuInfo[];
  blacklist: BlacklistItem[];
  running: boolean;
  kugouLoggedIn: boolean;
  kugouCache: Record<string, EnrichedEntry>;
  logs: string[];
  activeTab: 'songs' | 'played' | 'blacklist';
  onTabChange: (tab: 'songs' | 'played' | 'blacklist') => void;
  onClearList: () => void;
  onClearPlayed: () => void;
  onClearLogs: () => void;
  onContextMenu: (e: React.MouseEvent, song: DanmuInfo) => void;
  renderSongActions: (s: DanmuInfo) => React.ReactNode;
  renderPlayedActions: (s: DanmuInfo) => React.ReactNode;
  onRemoveBlacklist: (id: number) => void;
  onAddSingerBlacklist: (singerName: string) => void;
}

// ─── Column definitions ───────────────────────────────────────────────────────

type SongsMeta = {
  kugouCache: Record<string, EnrichedEntry>;
  renderActions: (s: DanmuInfo) => React.ReactNode;
  onContextMenu: (e: React.MouseEvent, song: DanmuInfo) => void;
};

type PlayedMeta = {
  kugouCache: Record<string, EnrichedEntry>;
  renderActions: (s: DanmuInfo) => React.ReactNode;
  onContextMenu: (e: React.MouseEvent, song: DanmuInfo) => void;
};

function useSongsColumns() {
  return useMemo(
    () => [
      songColumnHelper.display({
        id: 'index',
        header: '#',
        size: 40,
        cell: (ctx) => <span className="text-fg-faint text-xs">{ctx.row.index + 1}</span>,
      }),
      songColumnHelper.accessor('uname', {
        header: '用户',
        size: 120,
        cell: (ctx) => (
          <span className="text-fg-muted block truncate text-xs">{ctx.getValue()}</span>
        ),
      }),
      songColumnHelper.accessor('song_name', {
        header: '点歌',
        size: 160,
        meta: { grow: true },
        cell: (ctx) => {
          const meta = ctx.table.options.meta as SongsMeta;
          const song = ctx.row.original;
          const entry = meta?.kugouCache?.[song.song_name.trim()];
          return (
            <div
              className="cursor-default leading-snug"
              onContextMenu={(e) => meta?.onContextMenu(e, song)}
            >
              <div className="text-fg-base truncate text-[13px] font-medium">{song.song_name}</div>
              {entry?.status === 'found' ? (
                entry.blockedReason ? (
                  <>
                    <div className="truncate text-[11px] text-red-500">{entry.track.filename}</div>
                    <div className="truncate text-[11px] text-red-400">
                      {entry.blockedReason === 'singer'
                        ? `黑名单歌手: ${entry.track.singer_name}`
                        : '黑名单歌曲'}
                    </div>
                  </>
                ) : (
                  <div className="truncate text-[11px] text-blue-500">{entry.track.filename}</div>
                )
              ) : entry?.status === 'pending' ? (
                <div className="text-fg-faint text-[11px]">⋯ 搜索中</div>
              ) : entry?.status === 'not_found' ? (
                <div className="text-fg-faint text-[11px]">未找到</div>
              ) : null}
            </div>
          );
        },
      }),
      songColumnHelper.accessor('send_time', {
        header: '时间',
        size: 72,
        cell: (ctx) => {
          const d = new Date(ctx.getValue() * 1000);
          const pad = (n: number) => String(n).padStart(2, '0');
          return (
            <span className="text-fg-faint text-xs">
              {pad(d.getHours())}:{pad(d.getMinutes())}:{pad(d.getSeconds())}
            </span>
          );
        },
      }),
      songColumnHelper.display({
        id: 'actions',
        header: '',
        size: 110,
        cell: (ctx) => {
          const meta = ctx.table.options.meta as SongsMeta;
          return (
            <div className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
              {meta?.renderActions(ctx.row.original)}
            </div>
          );
        },
      }),
    ],
    [],
  );
}

function usePlayedColumns() {
  return useMemo(
    () => [
      songColumnHelper.display({
        id: 'index',
        header: '#',
        size: 40,
        cell: (ctx) => <span className="text-fg-faint text-xs">{ctx.row.index + 1}</span>,
      }),
      songColumnHelper.accessor('played_at', {
        id: 'played_time',
        header: '时间',
        size: 80,
        cell: (ctx) => {
          const ts = ctx.getValue() ?? ctx.row.original.send_time;
          const d = new Date(ts * 1000);
          const pad = (n: number) => String(n).padStart(2, '0');
          return (
            <span className="text-fg-faint text-xs">
              {pad(d.getHours())}:{pad(d.getMinutes())}:{pad(d.getSeconds())}
            </span>
          );
        },
      }),
      songColumnHelper.accessor('uname', {
        header: '用户',
        size: 110,
        cell: (ctx) => (
          <span className="text-fg-muted block truncate text-xs">{ctx.getValue()}</span>
        ),
      }),
      songColumnHelper.accessor('song_name', {
        header: '点歌',
        size: 160,
        meta: { grow: true },
        cell: (ctx) => {
          const meta = ctx.table.options.meta as PlayedMeta;
          const song = ctx.row.original;
          const entry = meta?.kugouCache?.[song.song_name.trim()];
          return (
            <div
              className="cursor-default leading-snug"
              onContextMenu={(e) => meta?.onContextMenu(e, song)}
            >
              <div className="text-fg-base truncate text-[13px] font-medium">{song.song_name}</div>
              {entry?.status === 'found' && (
                <div className="truncate text-[11px] text-blue-500">{entry.track.filename}</div>
              )}
            </div>
          );
        },
      }),
      songColumnHelper.display({
        id: 'actions',
        header: '',
        size: 48,
        cell: (ctx) => {
          const meta = ctx.table.options.meta as PlayedMeta;
          return (
            <div className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
              {meta?.renderActions(ctx.row.original)}
            </div>
          );
        },
      }),
    ],
    [],
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

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
  onClearLogs,
  onContextMenu,
  renderSongActions,
  renderPlayedActions,
  onRemoveBlacklist,
  onAddSingerBlacklist,
}: Props) {
  const songsColumns = useSongsColumns();
  const playedColumns = usePlayedColumns();

  const songsMeta: SongsMeta = useMemo(
    () => ({ kugouCache, renderActions: renderSongActions, onContextMenu }),
    [kugouCache, renderSongActions, onContextMenu],
  );

  const playedMeta: PlayedMeta = useMemo(
    () => ({ kugouCache, renderActions: renderPlayedActions, onContextMenu }),
    [kugouCache, renderPlayedActions, onContextMenu],
  );

  const windowWidth = useWindowWidth();
  const isNarrow = windowWidth < 720;

  // Hide less-important columns when window is narrow
  const narrowVisibility = useMemo(
    (): Record<string, boolean> =>
      isNarrow ? { uname: false, send_time: false, played_time: false } : {},
    [isNarrow],
  );

  const tabDefs = [
    { key: 'songs' as const, label: `点歌列表 (${songs.length})` },
    { key: 'played' as const, label: `已点歌单 (${played.length})` },
    { key: 'blacklist' as const, label: `黑名单 (${blacklist.length})` },
  ];

  const blacklistItems: BlacklistItemUI[] = useMemo(
    () =>
      blacklist.map((item) => ({
        id: item.id,
        entryType: item.entryType,
        songName: item.songName,
        singerName: item.singerName,
        createdAt: item.createdAt,
      })),
    [blacklist],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tab area */}
      <div className="border-border-soft bg-bg-elev mx-3 mt-2 mb-2 flex flex-1 flex-col overflow-hidden rounded-lg border">
        <Tabs
          value={activeTab}
          onValueChange={(v) => onTabChange(v as 'songs' | 'played' | 'blacklist')}
          className="flex min-h-0 flex-1 flex-col gap-y-0"
        >
          {/* Tab bar */}
          <div className="flex shrink-0 items-center justify-between px-4">
            <TabsList variant={'line'} className="">
              {tabDefs.map((t) => (
                <TabsTrigger className={'after:opacity-0!'} key={t.key} value={t.key}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {activeTab === 'songs' && songs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-fg-muted h-7 gap-1 text-xs hover:text-red-500"
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
                className="text-fg-muted h-7 gap-1 text-xs hover:text-red-500"
                onClick={onClearPlayed}
              >
                <Trash2 className="size-3.5" />
                清空列表
              </Button>
            )}
          </div>

          <TabsContent value="songs" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden">
            {songs.length === 0 ? (
              <EmptyState running={running} />
            ) : (
              <SongTable
                songs={songs}
                emptyText={running ? '等待点歌...' : '点击 "开始" 连接直播间'}
                columns={songsColumns}
                meta={songsMeta}
                columnVisibility={narrowVisibility}
              />
            )}
          </TabsContent>

          <TabsContent value="played" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden">
            <SongTable
              songs={played}
              emptyText="暂无已点歌曲"
              columns={playedColumns}
              meta={playedMeta}
              columnVisibility={narrowVisibility}
            />
          </TabsContent>

          <TabsContent value="blacklist" className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden">
            <BlacklistPanel
              items={blacklistItems}
              onRemove={onRemoveBlacklist}
              onAddSinger={onAddSingerBlacklist}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Log panel */}
      <div className="mx-3 mb-2 shrink-0">
        <LogPanel logs={logs} onClear={onClearLogs} />
      </div>
    </div>
  );
}

function EmptyState({ running }: { running: boolean }) {
  return (
    <div className="text-fg-faint flex flex-1 flex-col items-center justify-center gap-3 py-16">
      <div className="bg-bg-soft flex size-16 items-center justify-center rounded-2xl">
        <Music className="text-fg-faint size-8" />
      </div>
      <div className="text-center">
        <div className="text-fg-muted font-medium">
          {running ? '等待点歌...' : '当前点歌列表为空'}
        </div>
        <div className="mt-1 text-xs">
          {running ? '正在监听直播间弹幕' : '观众点歌后会显示在这里'}
        </div>
      </div>
    </div>
  );
}
