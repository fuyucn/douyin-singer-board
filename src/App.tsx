import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore, dedupedSongs } from './store';
import { useShallow } from 'zustand/react/shallow';
import {
  loadConfig,
  saveConfig,
  insertHistory,
  deleteHistoryByMsgId,
  clearSessionHistory,
} from './db';
import type { DanmuInfo } from './types';
import { checkForUpdate, openInBrowser, skipVersion, type UpdateInfo } from './updater';
import { Button } from '@/components/ui/button';

import { Copy, Trash2, ListPlus, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AboutModal } from './AboutModal';
import { KugouDebugModal } from './KugouDebugModal';
import { KugouLoginModal } from './KugouLoginModal';
import { applyTheme, loadTheme, type Theme } from './theme';
import { addTrackToPlaylist, type KuGouTrack, type EnrichedEntry } from './kugouSession';
import { useAutoSync } from './hooks/useAutoSync';
import { useBlacklist } from './hooks/useBlacklist';
import { useContextMenu } from './hooks/useContextMenu';
import { useKugouAuth } from './hooks/useKugouAuth';
import { useKugouSearch } from './hooks/useKugouSearch';
import { useSidecarEvents } from './hooks/useSidecarEvents';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { ContextMenu } from './components/ContextMenu';
import { StatusLine } from './components/StatusLine';
import { AppHeader } from './components/AppHeader';
import { LeftPanel } from './components/LeftPanel';
import { MainContent } from './components/MainContent';
import { CollapsiblePanel } from './components/CollapsiblePanel';
import { useWindowWidth } from './hooks/useWindowWidth';
import { TooltipProvider } from '@/components/ui/tooltip';

declare const __APP_VERSION__: string;

export default function App() {
  const {
    config,
    setConfig,
    hydrateConfig,
    running,
    setRunning,
    sessionId,
    newSession,
    setStatus,
    songs,
    removeByMsgId,
    clearSongs,
    manualAdd,
    logs,
    pushLog,
    clearLogs,
    preferCumulative,
    autoSync,
    setAutoSync,
    played,
    addPlayed,
    removePlayed,
    clearPlayed,
    startupSteps,
    setStartupStep,
    resetStartupSteps,
  } = useAppStore(
    useShallow((s) => ({
      config: s.config,
      setConfig: s.setConfig,
      hydrateConfig: s.hydrateConfig,
      running: s.running,
      setRunning: s.setRunning,
      sessionId: s.sessionId,
      newSession: s.newSession,
      setStatus: s.setStatus,
      songs: s.songs,
      removeByMsgId: s.removeByMsgId,
      clearSongs: s.clearSongs,
      manualAdd: s.manualAdd,
      logs: s.logs,
      pushLog: s.pushLog,
      clearLogs: s.clearLogs,
      preferCumulative: s.preferCumulative,
      autoSync: s.autoSync,
      setAutoSync: s.setAutoSync,
      played: s.played,
      addPlayed: s.addPlayed,
      removePlayed: s.removePlayed,
      clearPlayed: s.clearPlayed,
      startupSteps: s.startupSteps,
      setStartupStep: s.setStartupStep,
      resetStartupSteps: s.resetStartupSteps,
    })),
  );

  const {
    blacklist,
    checkTrack,
    addSong: addBlacklistSong,
    addSinger: addBlacklistSinger,
    remove: removeBlacklist,
  } = useBlacklist();
  const { ctxMenu, open: openCtxMenu, close: closeCtxMenu } = useContextMenu();

  const [manualText, setManualText] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showKgDebug, setShowKgDebug] = useState(false);
  const [showKgLogin, setShowKgLogin] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme());
  const [activeTab, setActiveTab] = useState<'songs' | 'played' | 'blacklist'>('songs');

  const windowWidth = useWindowWidth();
  const isNarrow = windowWidth < 720;

  const kugouLoggedIn = useKugouAuth({ watchTokens: [showKgDebug, showKgLogin] });

  useEffect(() => {
    if (kugouLoggedIn) setStartupStep('kugou', 'done');
  }, [kugouLoggedIn, setStartupStep]);

  // Show window after React mounts — avoids black-screen flash on macOS.
  useEffect(() => {
    invoke('show_window').catch(() => {});
  }, []);

  // Remove splash screen after first render.
  useEffect(() => {
    const splash = document.getElementById('splash');
    if (!splash) return;
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 200);
  }, []);

  const display = useMemo(() => dedupedSongs(songs), [songs]);

  const kugouCache = useKugouSearch({
    songs: display,
    played,
    kugouLoggedIn,
    preferCumulative,
  });

  // Enrich cache with blacklist status — single source of truth consumed by
  // both UI (red text) and auto-sync (skip decision).
  const enrichedCache = useMemo<Record<string, EnrichedEntry>>(() => {
    const result: Record<string, EnrichedEntry> = {};
    for (const [name, entry] of Object.entries(kugouCache)) {
      if (entry.status === 'found') {
        result[name] = { ...entry, blockedReason: checkTrack(entry.track) };
      } else {
        result[name] = entry;
      }
    }
    return result;
  }, [kugouCache, checkTrack]);

  useSidecarEvents();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Startup: load config
  useEffect(() => {
    (async () => {
      try {
        hydrateConfig(await loadConfig());
      } catch (e) {
        setBootError(`加载配置失败: ${e}`);
      }
    })();
  }, [hydrateConfig]);

  // Startup: update check
  useEffect(() => {
    checkForUpdate().then((info) => {
      if (info) setUpdate(info);
    });
  }, []);

  const onStart = async () => {
    pushLog('[app] start clicked');
    if (!config.room_id.trim()) {
      setBootError('请填写抖音直播间 ID');
      return;
    }
    setBootError(null);
    resetStartupSteps();
    setRunning(true);
    try {
      await saveConfig(config);
      const sid = newSession();
      clearSongs();
      clearPlayed();
      await clearSessionHistory(sid).catch(() => {});
      const blNames = blacklist
        .filter((e) => e.entryType === 'song' && e.songName)
        .map((e) => e.songName);
      await invoke('sidecar_send', {
        cmd: { cmd: 'start', config: { ...config, blacklist: blNames } },
      });
      pushLog(`[app] sidecar started, session=${sid}`);
    } catch (e) {
      setRunning(false);
      pushLog(`[app] start failed: ${e}`);
      setBootError(`启动失败: ${e}`);
    }
  };

  const onStop = async () => {
    pushLog('[app] stop clicked');
    try {
      await invoke('sidecar_send', { cmd: { cmd: 'stop' } });
    } catch (e) {
      pushLog(`[app] stop error: ${e}`);
    } finally {
      setRunning(false);
      setStatus({ connected: false, message: '已停止' });
    }
  };

  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`已复制: ${text}`);
    } catch (e) {
      toast.error(`复制失败: ${e}`);
    }
  };

  const onManualAdd = () => {
    const t = manualText.trim();
    if (!t) return;
    const item = manualAdd(t);
    if (sessionId) insertHistory(item, sessionId).catch(() => {});
    setManualText('');
    toast(`已添加: ${t}`);
  };

  const onRemoveOne = async (msgId: string, name: string) => {
    removeByMsgId(msgId);
    await deleteHistoryByMsgId(msgId).catch(() => {});
    toast(`已删除: ${name}`);
  };

  const onClearList = async () => {
    const n = display.length;
    clearSongs();
    if (sessionId) await clearSessionHistory(sessionId).catch(() => {});
    toast(`已清空 ${n} 条`);
  };

  const onAddToPlaylist = async (track: KuGouTrack, song: DanmuInfo) => {
    if (!config.target_playlist_id) {
      toast.error('请先在"Kugou歌单"里保存一个歌单');
      return;
    }
    const reason = checkTrack(track);
    if (reason) {
      toast.error(
        reason === 'singer'
          ? `已黑名单该歌手: ${track.singer_name}`
          : `已黑名单: ${track.filename} - ${track.singer_name}`,
      );
      return;
    }
    try {
      await addTrackToPlaylist(track, config.target_playlist_id);
      removeByMsgId(song.msg_id);
      addPlayed(song);
      await deleteHistoryByMsgId(song.msg_id).catch(() => {});
      toast(`已加入歌单: ${track.filename}`);
    } catch (e) {
      toast.error(`加入歌单失败: ${e}`);
    }
  };

  const onAutoSynced = (track: KuGouTrack, song: DanmuInfo) => {
    removeByMsgId(song.msg_id);
    addPlayed(song);
    deleteHistoryByMsgId(song.msg_id).catch(() => {});
    toast(`[自动] 已加入歌单: ${track.filename}`);
  };

  useAutoSync({
    autoSync,
    songs: display,
    kugouCache: enrichedCache,
    targetPlaylistId: config.target_playlist_id,
    kugouLoggedIn,
    onSynced: onAutoSynced,
    pushLog,
  });

  // ─── Render helpers ───────────────────────────────────────────

  const renderSongActions = (s: DanmuInfo) => {
    const entry: EnrichedEntry = enrichedCache[s.song_name.trim()] ?? { status: 'pending' };
    const hasTarget = config.target_playlist_id > 0;
    let title = '';
    let enabled = entry.status === 'found' && hasTarget;
    switch (entry.status) {
      case 'pending':
        title = '正在 KuGou 查找…';
        break;
      case 'found':
        title = hasTarget ? `加入歌单: ${entry.track.filename}` : '请先保存Kugou歌单';
        break;
      case 'not_found':
        title = 'KuGou 未找到这首歌';
        break;
      case 'error':
        title = `KuGou 搜索失败: ${entry.msg}`;
        break;
    }
    return (
      <div className="flex items-center gap-1">
        {kugouLoggedIn && (
          <Tooltip>
            <TooltipTrigger>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-[var(--fg-muted)] hover:text-blue-500"
                disabled={!enabled}
                onClick={() => entry.status === 'found' && onAddToPlaylist(entry.track, s)}
              >
                {entry.status === 'pending' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ListPlus className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {title || '加入歌单'}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-[var(--fg-muted)] hover:text-[var(--fg-base)]"
              onClick={() => onCopy(s.song_name)}
            >
              <Copy className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            复制歌名
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-[var(--fg-muted)] hover:text-red-500"
              onClick={() => onRemoveOne(s.msg_id, s.song_name)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            删除
          </TooltipContent>
        </Tooltip>
      </div>
    );
  };

  const renderPlayedActions = (s: DanmuInfo) => (
    <Tooltip>
      <TooltipTrigger>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-[var(--fg-muted)] hover:text-[var(--fg-base)]"
          onClick={() => onCopy(s.song_name)}
        >
          <Copy className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        复制歌名
      </TooltipContent>
    </Tooltip>
  );

  const ctxSong = ctxMenu?.song;
  const kgEntry = ctxSong ? enrichedCache[ctxSong.song_name.trim()] : undefined;
  const kgFound = kgEntry?.status === 'found' && kgEntry.track;

  const ctxActions = ctxMenu
    ? [
        { label: '复制弹幕', onClick: () => onCopy(ctxSong!.raw_msg) },
        {
          label: kgFound ? '复制歌名' : '复制歌名 (未找到)',
          onClick: () => kgFound && onCopy(kgFound.filename),
          disabled: !kgFound,
        },
        {
          label: '删除',
          onClick: () => {
            if (activeTab === 'played') {
              removePlayed(ctxSong!.msg_id);
            } else {
              onRemoveOne(ctxSong!.msg_id, ctxSong!.song_name);
            }
          },
        },
        ...(kgFound
          ? [
              {
                label: `黑名单这首歌: ${kgFound.filename} - ${kgFound.singer_name}`,
                onClick: () => {
                  addBlacklistSong(kgFound.filename, kgFound.singer_name, ctxSong!.msg_id);
                  toast(`已加入黑名单: ${kgFound.filename}`);
                },
              },
              ...(kgFound.singer_name
                ? [
                    {
                      label: `黑名单该歌手: ${kgFound.singer_name}`,
                      onClick: () => {
                        addBlacklistSinger(kgFound.singer_name);
                        toast(`已加入黑名单歌手: ${kgFound.singer_name}`);
                      },
                    },
                  ]
                : []),
            ]
          : [
              {
                label: '加入黑名单 (搜索中…)',
                disabled: true,
                onClick: () => {},
              },
            ]),
      ]
    : [];

  // ─── Render ────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)]">
        {/* Header */}
        <AppHeader
          theme={theme}
          running={running}
          kugouLoggedIn={kugouLoggedIn}
          onThemeChange={(t) => {
            setTheme(t);
            applyTheme(t);
          }}
          onShowKgLogin={() => setShowKgLogin(true)}
          onShowAbout={() => setShowAbout(true)}
          onShowKgDebug={import.meta.env.DEV ? () => setShowKgDebug(true) : undefined}
          onStart={onStart}
          onStop={onStop}
        />

        {/* Error banner */}
        {bootError && (
          <div className="bg-danger-soft-bg text-danger-soft-fg px-5 py-2 text-sm">{bootError}</div>
        )}

        {/* Update banner */}
        {update && (
          <div className="border-accent-soft-border bg-accent-soft-bg text-accent-soft-fg flex items-center gap-3 border-b px-5 py-2 text-sm">
            <span>新版本 {update.tag} 可用</span>
            <Button
              size="sm"
              className="h-7 px-3 text-[13px]"
              onClick={() => openInBrowser(update.htmlUrl)}
            >
              前往下载
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-lg"
              onClick={() => {
                skipVersion(update.tag);
                setUpdate(null);
              }}
            >
              跳过
            </Button>
          </div>
        )}

        {/* Main layout — side-by-side on wide, stacked on narrow */}
        {isNarrow ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <CollapsiblePanel>
              <LeftPanel
                config={config}
                running={running}
                autoSync={autoSync}
                kugouLoggedIn={kugouLoggedIn}
                manualText={manualText}
                compact
                onConfigChange={setConfig}
                onManualTextChange={setManualText}
                onManualAdd={onManualAdd}
                onAutoSyncToggle={() => setAutoSync(!autoSync)}
                appVersion={typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}
              />
            </CollapsiblePanel>

            <MainContent
              songs={display}
              played={played}
              blacklist={blacklist}
              running={running}
              kugouLoggedIn={kugouLoggedIn}
              kugouCache={enrichedCache}
              logs={logs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onClearList={onClearList}
              onClearPlayed={clearPlayed}
              onClearLogs={clearLogs}
              onContextMenu={openCtxMenu}
              renderSongActions={renderSongActions}
              renderPlayedActions={renderPlayedActions}
              onRemoveBlacklist={(id) => {
                removeBlacklist(id);
                toast('已移出黑名单');
              }}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <LeftPanel
              config={config}
              running={running}
              autoSync={autoSync}
              kugouLoggedIn={kugouLoggedIn}
              manualText={manualText}
              onConfigChange={setConfig}
              onManualTextChange={setManualText}
              onManualAdd={onManualAdd}
              onAutoSyncToggle={() => setAutoSync(!autoSync)}
              appVersion={typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}
            />

            <MainContent
              songs={display}
              played={played}
              blacklist={blacklist}
              running={running}
              kugouLoggedIn={kugouLoggedIn}
              kugouCache={enrichedCache}
              logs={logs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onClearList={onClearList}
              onClearPlayed={clearPlayed}
              onClearLogs={clearLogs}
              onContextMenu={openCtxMenu}
              renderSongActions={renderSongActions}
              renderPlayedActions={renderPlayedActions}
              onRemoveBlacklist={(id) => {
                removeBlacklist(id);
                toast('已移出黑名单');
              }}
            />
          </div>
        )}

        {/* Context menu */}
        {ctxMenu && (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            song={ctxMenu.song}
            items={ctxActions}
            onClose={closeCtxMenu}
          />
        )}

        {/* Status line */}
        <StatusLine steps={startupSteps} />

        <Toaster position="bottom-right" richColors />

        {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
        {showKgLogin && <KugouLoginModal onClose={() => setShowKgLogin(false)} />}
        {showKgDebug && <KugouDebugModal onClose={() => setShowKgDebug(false)} />}
      </div>
    </TooltipProvider>
  );
}
