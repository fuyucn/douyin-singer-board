import { useMemo, useState } from 'react';
import { useWindowWidth } from '@/hooks/useWindowWidth';
import { Trash2, Music, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { countAddedByUid } from '@/lib/userQuota';
import { SongTable, songColumnHelper } from './SongTable';
import { BlacklistPanel, type BlacklistItemUI } from './BlacklistPanel';
import { LogPanel } from './LogPanel';
import { useShowLogs } from '../hooks/useShowLogs';
import type { DanmuInfo } from '../types';
import type { EnrichedEntry } from '../kugouSession';
import type { BlacklistItem } from '../store/blacklist';

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
  cooldownRemaining: (songName: string) => number;
  maxSongsPerUser: number;
}

// ─── Column definitions ───────────────────────────────────────────────────────

type UserCountMeta = {
  // How many songs this requester has already added to the playlist (played)
  // this session, plus the configured limit (0 = unlimited). Same value for
  // every row of a given user; drives the "2/3" badge and turns red at/over
  // the limit (those users' further requests are skipped by auto-sync).
  addedCount: (uid: string) => number;
  maxSongsPerUser: number;
};

type SongsMeta = UserCountMeta & {
  kugouCache: Record<string, EnrichedEntry>;
  renderActions: (s: DanmuInfo) => React.ReactNode;
  onContextMenu: (e: React.MouseEvent, song: DanmuInfo) => void;
  cooldownRemaining: (songName: string) => number;
};

// Renders the username plus a per-user "added/limit" badge (e.g. "2/3"):
// how many songs this user has already added to the playlist this session.
// Same value for all of a user's rows. Hidden when the limit is unlimited (0)
// or for manual host adds. Red once the user is at/over the limit — their
// further requests are skipped by auto-sync.
function renderUserCell(ctx: {
  table: { options: { meta?: unknown } };
  row: { original: DanmuInfo };
}) {
  const meta = ctx.table.options.meta as UserCountMeta | undefined;
  const song = ctx.row.original;
  const limit = meta?.maxSongsPerUser ?? 0;
  const show = limit > 0 && song.uid !== 'manual';
  const count = show ? (meta?.addedCount(song.uid) ?? 0) : 0;
  const capped = count >= limit;
  return (
    <div className="flex items-center gap-1">
      <span className="text-fg-muted truncate text-xs">{song.uname}</span>
      {show && (
        <span
          className={cn(
            'shrink-0 rounded px-1 text-[10px] tabular-nums',
            capped ? 'bg-red-500/15 text-red-400' : 'bg-border-softer text-fg-faint',
          )}
          title={`本场已加入歌单 ${count}/${limit}`}
        >
          {count}/{limit}
        </span>
      )}
    </div>
  );
}

type PlayedMeta = UserCountMeta & {
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
        cell: renderUserCell,
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
                  <>
                    <div className="truncate text-[11px] text-blue-500">{entry.track.filename}</div>
                    {(() => {
                      const secs = meta?.cooldownRemaining(song.song_name);
                      if (!secs) return null;
                      const mins = Math.ceil(secs / 60);
                      return (
                        <div className="text-fg-faint text-[11px]">
                          冷却中 ({mins} 分钟后可再点)
                        </div>
                      );
                    })()}
                  </>
                )
              ) : entry?.status === 'pending' ? (
                <div className="text-fg-faint text-[11px]">⋯ 搜索中</div>
              ) : entry?.status === 'not_found' ? (
                <div className="text-fg-faint text-[11px]">未找到</div>
              ) : entry?.status === 'error' ? (
                <div className="text-[11px] text-orange-400">搜索失败</div>
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
        cell: renderUserCell,
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
  cooldownRemaining,
  maxSongsPerUser,
}: Props) {
  const songsColumns = useSongsColumns();
  const playedColumns = usePlayedColumns();
  const [playedQuery, setPlayedQuery] = useState('');
  const [showLogs] = useShowLogs();

  // Songs each user has already added to the playlist (played) this session.
  // Same source of truth as the auto-sync limit check (lib/userQuota), so the
  // badge and enforcement can never diverge.
  const addedCount = useMemo(() => {
    const m = countAddedByUid(played);
    return (uid: string) => m.get(uid) ?? 0;
  }, [played]);

  const filteredPlayed = useMemo(() => {
    const q = playedQuery.trim().toLowerCase();
    if (!q) return played;
    return played.filter(
      (s) =>
        s.song_name.toLowerCase().includes(q) ||
        s.uname.toLowerCase().includes(q),
    );
  }, [played, playedQuery]);

  const songsMeta: SongsMeta = useMemo(
    () => ({
      kugouCache,
      renderActions: renderSongActions,
      onContextMenu,
      cooldownRemaining,
      addedCount,
      maxSongsPerUser,
    }),
    [kugouCache, renderSongActions, onContextMenu, cooldownRemaining, addedCount, maxSongsPerUser],
  );

  const playedMeta: PlayedMeta = useMemo(
    () => ({
      kugouCache,
      renderActions: renderPlayedActions,
      onContextMenu,
      addedCount,
      maxSongsPerUser,
    }),
    [kugouCache, renderPlayedActions, onContextMenu, addedCount, maxSongsPerUser],
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
          <div className="flex shrink-0 items-center justify-between px-3 py-1">
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
            {played.length > 0 && (
              <div className="border-border-soft relative shrink-0 border-b px-3 py-1.5">
                <Search className="text-fg-faint pointer-events-none absolute top-1/2 left-5 size-3.5 -translate-y-1/2" />
                <Input
                  value={playedQuery}
                  onChange={(e) => setPlayedQuery(e.target.value)}
                  placeholder="搜索歌曲名或用户…"
                  className="h-7 bg-transparent pr-8 pl-7 text-xs"
                />
                {playedQuery && (
                  <button
                    type="button"
                    onClick={() => setPlayedQuery('')}
                    className="text-fg-faint hover:text-fg-base absolute top-1/2 right-5 -translate-y-1/2"
                    aria-label="清除"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
            <SongTable
              songs={filteredPlayed}
              emptyText={playedQuery ? '没有匹配的歌曲' : '暂无已点歌曲'}
              columns={playedColumns}
              meta={playedMeta}
              columnVisibility={narrowVisibility}
            />
          </TabsContent>

          <TabsContent
            value="blacklist"
            className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <BlacklistPanel
              items={blacklistItems}
              onRemove={onRemoveBlacklist}
              onAddSinger={onAddSingerBlacklist}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Log panel — gated by user preference */}
      {showLogs && (
        <div className="mx-3 mb-2 shrink-0">
          <LogPanel logs={logs} onClear={onClearLogs} />
        </div>
      )}
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
