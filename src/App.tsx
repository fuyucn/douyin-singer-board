import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore, dedupedSongs } from './store';
import {
  loadConfig,
  saveConfig,
  insertHistory,
  deleteHistoryByMsgId,
  clearSessionHistory,
} from './db';
import type { DanmuInfo } from './types';
import { checkForUpdate, openInBrowser, skipVersion, type UpdateInfo } from './updater';
import { PlusCircledIcon } from '@radix-ui/react-icons';
import { AboutModal } from './AboutModal';
import { KugouDebugModal } from './KugouDebugModal';
import { KugouLoginModal } from './KugouLoginModal';
import { applyTheme, loadTheme, type Theme } from './theme';
import { addTrackToPlaylist, type KuGouTrack, type KuGouEntry } from './kugouSession';
import { useAutoSync } from './hooks/useAutoSync';
import { useBlacklist } from './hooks/useBlacklist';
import { useContextMenu } from './hooks/useContextMenu';
import { useKugouAuth } from './hooks/useKugouAuth';
import { useKugouSearch } from './hooks/useKugouSearch';
import { useSidecarEvents } from './hooks/useSidecarEvents';
import { useToast } from './hooks/useToast';
import { ContextMenu } from './components/ContextMenu';
import { Toast } from './components/Toast';
import { StatusLine } from './components/StatusLine';
import { AppHeader } from './components/AppHeader';
import { LeftPanel } from './components/LeftPanel';
import { MainContent } from './components/MainContent';
import { TooltipProvider } from '@/components/ui/tooltip';

declare const __APP_VERSION__: string;

const btnAction =
  'px-2.5 py-1 text-xs border border-border-strong rounded bg-bg-elev text-fg-base cursor-pointer hover:bg-bg-soft';

export default function App() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const hydrateConfig = useAppStore((s) => s.hydrateConfig);
  const running = useAppStore((s) => s.running);
  const setRunning = useAppStore((s) => s.setRunning);
  const sessionId = useAppStore((s) => s.sessionId);
  const newSession = useAppStore((s) => s.newSession);
  const setStatus = useAppStore((s) => s.setStatus);
  const songs = useAppStore((s) => s.songs);
  const removeByMsgId = useAppStore((s) => s.removeByMsgId);
  const clearSongs = useAppStore((s) => s.clearSongs);
  const manualAdd = useAppStore((s) => s.manualAdd);
  const logs = useAppStore((s) => s.logs);
  const pushLog = useAppStore((s) => s.pushLog);
  const preferCumulative = useAppStore((s) => s.preferCumulative);
  const autoSync = useAppStore((s) => s.autoSync);
  const setAutoSync = useAppStore((s) => s.setAutoSync);
  const played = useAppStore((s) => s.played);
  const addPlayed = useAppStore((s) => s.addPlayed);
  const removePlayed = useAppStore((s) => s.removePlayed);
  const clearPlayed = useAppStore((s) => s.clearPlayed);
  const startupSteps = useAppStore((s) => s.startupSteps);
  const setStartupStep = useAppStore((s) => s.setStartupStep);
  const resetStartupSteps = useAppStore((s) => s.resetStartupSteps);

  const {
    blacklist,
    add: addBlacklist,
    remove: removeBlacklist,
    getNames: getBlacklistNames,
  } = useBlacklist();
  const { ctxMenu, open: openCtxMenu, close: closeCtxMenu } = useContextMenu();
  const { toast, showToast, dismissToast } = useToast();

  const [manualText, setManualText] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showKgDebug, setShowKgDebug] = useState(false);
  const [showKgLogin, setShowKgLogin] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme());
  const [activeTab, setActiveTab] = useState<'songs' | 'played' | 'blacklist'>('songs');

  const kugouLoggedIn = useKugouAuth({ watchTokens: [showKgDebug, showKgLogin] });

  useEffect(() => {
    if (kugouLoggedIn) setStartupStep('kugou', 'done');
  }, [kugouLoggedIn, setStartupStep]);

  const display = useMemo(() => dedupedSongs(songs), [songs]);

  const kugouCache = useKugouSearch({
    songs: display,
    played,
    kugouLoggedIn,
    preferCumulative,
  });

  useSidecarEvents({ blacklist });

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
      const blNames = await getBlacklistNames();
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
      showToast(`已复制: ${text}`);
    } catch (e) {
      showToast(`复制失败: ${e}`, 'error');
    }
  };

  const onManualAdd = () => {
    const t = manualText.trim();
    if (!t) return;
    const item = manualAdd(t);
    if (sessionId) insertHistory(item, sessionId).catch(() => {});
    setManualText('');
    showToast(`已添加: ${t}`);
  };

  const onRemoveOne = async (msgId: string, name: string) => {
    removeByMsgId(msgId);
    await deleteHistoryByMsgId(msgId).catch(() => {});
    showToast(`已删除: ${name}`);
  };

  const onClearList = async () => {
    const n = display.length;
    clearSongs();
    if (sessionId) await clearSessionHistory(sessionId).catch(() => {});
    showToast(`已清空 ${n} 条`);
  };

  const onAddToPlaylist = async (track: KuGouTrack, song: DanmuInfo) => {
    if (!config.target_playlist_id) {
      showToast('请先在"Kugou歌单"里保存一个歌单', 'error');
      return;
    }
    try {
      await addTrackToPlaylist(track, config.target_playlist_id);
      removeByMsgId(song.msg_id);
      addPlayed(song);
      await deleteHistoryByMsgId(song.msg_id).catch(() => {});
      showToast(`已加入歌单: ${track.filename}`);
    } catch (e) {
      showToast(`加入歌单失败: ${e}`, 'error');
    }
  };

  const onAutoSynced = (track: KuGouTrack, song: DanmuInfo) => {
    removeByMsgId(song.msg_id);
    addPlayed(song);
    deleteHistoryByMsgId(song.msg_id).catch(() => {});
    showToast(`[自动] 已加入歌单: ${track.filename}`);
  };

  useAutoSync({
    autoSync,
    songs: display,
    kugouCache,
    targetPlaylistId: config.target_playlist_id,
    kugouLoggedIn,
    onSynced: onAutoSynced,
    pushLog,
  });

  // ─── Render helpers ───────────────────────────────────────────

  const renderSongActions = (s: DanmuInfo) => {
    const entry: KuGouEntry = kugouCache[s.song_name.trim()] ?? { status: 'pending' };
    const hasTarget = config.target_playlist_id > 0;
    let label: React.ReactNode = (
      <>
        <PlusCircledIcon className="size-4" /> 加入歌单
      </>
    );
    let title = '';
    let enabled = entry.status === 'found' && hasTarget;
    switch (entry.status) {
      case 'pending':
        label = (
          <>
            <PlusCircledIcon className="size-4" /> ⋯
          </>
        );
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
      <>
        {kugouLoggedIn && (
          <button
            className={`${btnAction} inline-flex items-center gap-1`}
            disabled={!enabled}
            onClick={() => entry.status === 'found' && onAddToPlaylist(entry.track, s)}
            title={title}
          >
            {label}
          </button>
        )}
        <button className={btnAction} onClick={() => onCopy(s.song_name)}>
          复制
        </button>
        <button className={btnAction} onClick={() => onRemoveOne(s.msg_id, s.song_name)}>
          删除
        </button>
      </>
    );
  };

  const renderPlayedActions = (s: DanmuInfo) => (
    <button className={btnAction} onClick={() => onCopy(s.song_name)}>
      复制
    </button>
  );

  const ctxSong = ctxMenu?.song;
  const kgEntry = ctxSong ? kugouCache[ctxSong.song_name.trim()] : undefined;
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
        {
          label: '加入黑名单',
          onClick: () => {
            addBlacklist(ctxSong!.song_name, ctxSong!.msg_id);
            showToast(`已加入黑名单: ${ctxSong!.song_name}`);
          },
        },
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
          <div className="bg-danger-soft-bg text-danger-soft-fg px-5 py-2 text-sm">
            {bootError}
          </div>
        )}

        {/* Update banner */}
        {update && (
          <div className="border-accent-soft-border bg-accent-soft-bg text-accent-soft-fg flex items-center gap-3 border-b px-5 py-2 text-sm">
            <span>新版本 {update.tag} 可用</span>
            <button
              className="border-accent bg-accent hover:bg-accent-hover cursor-pointer rounded border px-3 py-1 text-[13px] text-white"
              onClick={() => openInBrowser(update.htmlUrl)}
            >
              前往下载
            </button>
            <button
              className="text-accent-soft-fg ml-auto cursor-pointer border-none bg-transparent px-2 py-0 text-lg hover:bg-black/[.08]"
              onClick={() => {
                skipVersion(update.tag);
                setUpdate(null);
              }}
            >
              跳过
            </button>
          </div>
        )}

        {/* Main two-column layout */}
        <div className="flex min-h-0 flex-1">
          {/* Left panel */}
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
            showToast={showToast}
            appVersion={typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}
          />

          {/* Right main content */}
          <MainContent
            songs={display}
            played={played}
            blacklist={blacklist}
            running={running}
            kugouLoggedIn={kugouLoggedIn}
            kugouCache={kugouCache}
            logs={logs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onClearList={onClearList}
            onClearPlayed={clearPlayed}
            onContextMenu={openCtxMenu}
            renderSongActions={renderSongActions}
            renderPlayedActions={renderPlayedActions}
            onRemoveBlacklist={(name) => {
              removeBlacklist(name);
              showToast(`已移出黑名单: ${name}`);
            }}
          />
        </div>

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

        {/* Toast */}
        {toast && <Toast toast={toast} onDismiss={dismissToast} />}

        {showAbout && <AboutModal onClose={() => setShowAbout(false)} onShowToast={showToast} />}
        {showKgLogin && <KugouLoginModal onClose={() => setShowKgLogin(false)} />}
        {showKgDebug && <KugouDebugModal onClose={() => setShowKgDebug(false)} />}
      </div>
    </TooltipProvider>
  );
}
