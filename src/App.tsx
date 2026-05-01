import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore, dedupedSongs } from './store';
import {
  loadConfig,
  saveConfig,
  insertHistory,
  deleteHistoryByMsgId,
  clearSessionHistory,
  loadKugouSession,
} from './db';
import type { DanmuInfo, SidecarEvent } from './types';
import { checkForUpdate, openInBrowser, skipVersion, type UpdateInfo } from './updater';
import {
  CircleBackslashIcon,
  GearIcon,
  InfoCircledIcon,
  MoonIcon,
  PlusCircledIcon,
  SunIcon,
} from '@radix-ui/react-icons';
import { AboutModal } from './AboutModal';
import { KugouDebugModal } from './KugouDebugModal';
import { KugouLoginModal } from './KugouLoginModal';
import { applyTheme, loadTheme, nextTheme, saveTheme, themeLabel, type Theme } from './theme';
import {
  refreshTokenIfStale,
  resolvePlaylistByName,
  searchKuGouPreferredHit,
  searchKuGouTopHit,
  listenHistoryMap,
  addTrackToPlaylist,
  type KuGouTrack,
  type KuGouEntry,
} from './kugouSession';
import { useAutoSync } from './hooks/useAutoSync';
import { useBlacklist } from './hooks/useBlacklist';
import { useContextMenu } from './hooks/useContextMenu';
import { SongList } from './components/SongList';
import { BlacklistPanel } from './components/BlacklistPanel';
import { ContextMenu } from './components/ContextMenu';
import { AppLogo } from './components/AppLogo';
import { ConnectionStatus } from './components/ConnectionStatus';

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') return <SunIcon />;
  if (theme === 'dark') return <MoonIcon />;
  return <CircleBackslashIcon />;
}

// shared button styles
const btnBase =
  'py-1.5 px-3.5 border border-border-strong rounded bg-bg-elev text-fg-base cursor-pointer hover:bg-bg-soft disabled:opacity-40 disabled:cursor-not-allowed';
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
  const addSong = useAppStore((s) => s.addSong);
  const cancelByUid = useAppStore((s) => s.cancelByUid);
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

  const {
    blacklist,
    add: addBlacklist,
    remove: removeBlacklist,
    getNames: getBlacklistNames,
  } = useBlacklist();
  const { ctxMenu, open: openCtxMenu, close: closeCtxMenu } = useContextMenu();

  const [manualText, setManualText] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showKgDebug, setShowKgDebug] = useState(false);
  const [showKgLogin, setShowKgLogin] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme());
  const [activeTab, setActiveTab] = useState<'songs' | 'played' | 'blacklist'>('songs');
  const [kugouLoggedIn, setKugouLoggedIn] = useState(false);

  useEffect(() => {
    loadKugouSession()
      .then((s) => setKugouLoggedIn(Boolean(s.token && s.userid && s.dfid)))
      .catch(() => setKugouLoggedIn(false));
  }, [showKgDebug, showKgLogin]);

  // Turn off auto-sync when logging out (kugouLoggedIn transitions true→false).
  const kgRef = useRef(kugouLoggedIn);
  useEffect(() => {
    if (!kugouLoggedIn && kgRef.current) setAutoSync(false);
    kgRef.current = kugouLoggedIn;
  }, [kugouLoggedIn, setAutoSync]);

  useEffect(() => {
    if (!kugouLoggedIn) return;
    listenHistoryMap()
      .then((m) => pushLog(`[kugou] listen history cached: ${m.size} hashes`))
      .catch((e) => pushLog(`[kugou] listen history failed: ${e}`));
  }, [kugouLoggedIn, pushLog]);

  // KuGou search cache
  const [kugouCache, setKugouCache] = useState<Record<string, KuGouEntry>>({});
  const kugouStartedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const showToast = (msg: string, kind: 'success' | 'error' = 'success') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 1600);
  };

  const display = useMemo(() => dedupedSongs(songs), [songs]);

  // Pre-fetch KuGou search
  useEffect(() => {
    if (!kugouLoggedIn) return;
    for (const s of [...display, ...played]) {
      const name = s.song_name.trim();
      if (!name || kugouStartedRef.current.has(name)) continue;
      kugouStartedRef.current.add(name);
      setKugouCache((prev) => ({ ...prev, [name]: { status: 'pending' } }));
      const search = preferCumulative ? searchKuGouPreferredHit : searchKuGouTopHit;
      search(name)
        .then((track) => {
          setKugouCache((prev) => ({
            ...prev,
            [name]: track ? { status: 'found', track } : { status: 'not_found' },
          }));
        })
        .catch((err) => {
          setKugouCache((prev) => ({ ...prev, [name]: { status: 'error', msg: String(err) } }));
        });
    }
  }, [display, played, kugouLoggedIn, preferCumulative]);

  // Startup: config
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

  // Startup: Kugou token refresh
  useEffect(() => {
    const t = window.setTimeout(() => {
      refreshTokenIfStale().catch(() => {});
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  // Sidecar events
  useEffect(() => {
    const unlisten = listen<SidecarEvent>('sidecar-event', (e) => {
      const ev = e.payload;
      switch (ev.event) {
        case 'danmu':
          if (blacklist.has(ev.data.song_name)) break;
          addSong(ev.data);
          if (sessionId) insertHistory(ev.data, sessionId).catch((err) => pushLog(`db: ${err}`));
          break;
        case 'cancel':
          cancelByUid(ev.uid);
          break;
        case 'status':
          setStatus({ connected: ev.connected, message: ev.message });
          break;
        case 'log':
          pushLog(`[${ev.level}] ${ev.msg}`);
          break;
        case 'error':
          pushLog(`[error] ${ev.msg}`);
          break;
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addSong, cancelByUid, setStatus, pushLog, sessionId, blacklist]);

  const onStart = async () => {
    pushLog('[app] start clicked');
    if (!config.room_id.trim()) {
      setBootError('请填写抖音直播间 ID');
      return;
    }
    setBootError(null);
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
      setRunning(true);
      pushLog(`[app] sidecar started, session=${sid}`);
    } catch (e) {
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

  const onCopyAll = async () => {
    if (display.length === 0) return;
    try {
      await navigator.clipboard.writeText(display.map((s) => s.song_name).join('\n'));
      showToast(`已复制 ${display.length} 条到剪贴板`);
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

  // Auto-sync callback — track add already done by the hook, just update state.
  const onAutoSynced = (track: KuGouTrack, song: DanmuInfo) => {
    removeByMsgId(song.msg_id);
    addPlayed(song);
    deleteHistoryByMsgId(song.msg_id).catch(() => {});
    showToast(`[自动] 已加入歌单: ${track.filename}`);
  };

  // Auto-sync: background FIFO adder with 3-5s random delay
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
        <PlusCircledIcon /> 加入歌单
      </>
    );
    let title = '';
    let enabled = entry.status === 'found' && hasTarget;
    switch (entry.status) {
      case 'pending':
        label = (
          <>
            <PlusCircledIcon /> ⋯
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

  const ctxActions = ctxMenu
    ? [
        { label: '复制歌名', onClick: () => onCopy(ctxMenu.song.song_name) },
        {
          label: '删除',
          onClick: () => {
            if (activeTab === 'played') {
              removePlayed(ctxMenu.song.msg_id);
            } else {
              onRemoveOne(ctxMenu.song.msg_id, ctxMenu.song.song_name);
            }
          },
        },
        {
          label: '加入黑名单',
          onClick: () => {
            addBlacklist(ctxMenu.song.song_name, ctxMenu.song.msg_id);
            showToast(`已加入黑名单: ${ctxMenu.song.song_name}`);
          },
        },
      ]
    : [];

  // shared label + input block
  const configLabel = (label: string, input: React.ReactNode) => (
    <label className="flex min-w-[140px] flex-1 basis-[180px] flex-col gap-1">
      <span className="text-fg-muted text-xs">{label}</span>
      {input}
    </label>
  );

  const configInput =
    'py-1.5 px-2.5 border border-border-strong rounded bg-bg-base text-fg-base disabled:bg-bg-disabled disabled:text-fg-faint';

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-border-soft bg-bg-elev flex items-center gap-4 border-b px-5 py-3">
        <AppLogo />
        <h1 className="m-0 text-lg">SUSUSongBoard</h1>
        <ConnectionStatus />
        <button
          className="text-fg-muted hover:bg-bg-soft hover:border-border-strong hover:text-fg-base ml-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-sm leading-none"
          onClick={() => {
            const t = nextTheme(theme);
            saveTheme(t);
            setTheme(t);
          }}
          title={`主题: ${themeLabel(theme)}`}
        >
          <ThemeIcon theme={theme} />
        </button>
        <button
          className="text-fg-muted hover:bg-bg-soft hover:border-border-strong hover:text-fg-base inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-base leading-none"
          onClick={() => setShowKgLogin(true)}
          title={kugouLoggedIn ? '酷狗已登录' : '酷狗未登录'}
        >
          <img
            src="/kugou.svg"
            className={`block h-5 w-5 object-contain ${kugouLoggedIn ? '' : 'opacity-60 grayscale'}`}
            alt=""
          />
        </button>
        {import.meta.env.DEV && (
          <button
            className="text-fg-muted hover:bg-bg-soft hover:border-border-strong hover:text-fg-base inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent p-0 leading-none"
            onClick={() => setShowKgDebug(true)}
            title="KuGou API 调试面板"
          >
            <GearIcon />
          </button>
        )}
        <button
          className="text-fg-muted hover:bg-bg-soft hover:border-border-strong hover:text-fg-base inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent p-0 leading-none"
          onClick={() => setShowAbout(true)}
          title="关于 / 检查更新"
        >
          <InfoCircledIcon />
        </button>
      </header>

      {/* Error banner */}
      {bootError && (
        <div className="bg-danger-soft-bg text-danger-soft-fg px-5 py-2">{bootError}</div>
      )}

      {/* Update banner */}
      {update && (
        <div className="border-accent-soft-border bg-accent-soft-bg text-accent-soft-fg flex items-center gap-3 border-b px-5 py-2">
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

      {/* Config */}
      <section className="border-border-soft bg-bg-elev flex flex-wrap items-end gap-3 border-b px-5 py-3">
        {configLabel(
          '抖音直播间 ID',
          <input
            className={configInput}
            type="text"
            value={config.room_id}
            disabled={running}
            onChange={(e) => setConfig({ room_id: e.target.value })}
            placeholder="例如 221321076494"
          />,
        )}
        {configLabel(
          '点歌指令模板',
          <input
            className={configInput}
            type="text"
            value={config.sing_prefix}
            disabled={running}
            onChange={(e) => setConfig({ sing_prefix: e.target.value })}
            placeholder="点歌[space][song]"
            title="Placeholders: [space]=whitespace, [song]=song name"
          />,
        )}
        {configLabel(
          '最低粉丝团等级',
          <input
            className={configInput}
            type="number"
            min={0}
            value={config.fans_level}
            disabled={running}
            onChange={(e) => setConfig({ fans_level: Number(e.target.value) || 0 })}
          />,
        )}
        {configLabel(
          '点歌冷却 (秒)',
          <input
            className={configInput}
            type="number"
            min={0}
            value={config.sing_cd}
            disabled={running}
            onChange={(e) => setConfig({ sing_cd: Math.max(0, Number(e.target.value) || 0) })}
          />,
        )}
        {!running ? (
          <button
            className="bg-success hover:bg-success-hover cursor-pointer rounded border-none px-6 py-2 font-medium text-white"
            onClick={onStart}
          >
            开始
          </button>
        ) : (
          <button
            className="bg-danger hover:bg-danger-hover cursor-pointer rounded border-none px-6 py-2 font-medium text-white"
            onClick={onStop}
          >
            停止
          </button>
        )}
        {kugouLoggedIn && (
          <label className="flex min-w-[260px] flex-1 basis-[320px] flex-col gap-1">
            <span className="text-fg-muted text-xs">Kugou歌单</span>
            <div className="flex items-center gap-2">
              <input
                className={`${configInput} min-w-0 flex-1`}
                type="text"
                value={config.target_playlist_name}
                onChange={(e) => setConfig({ target_playlist_name: e.target.value })}
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
                    setConfig({ target_playlist_id: listid });
                    await saveConfig({
                      ...config,
                      target_playlist_name: name,
                      target_playlist_id: listid,
                    });
                    showToast(
                      created ? `已新建歌单 (id: ${listid})` : `已绑定歌单 (id: ${listid})`,
                    );
                  } catch (e) {
                    const detail = String(e);
                    showToast(
                      detail.includes('not logged in')
                        ? '请先点酷狗图标扫码登录'
                        : `解析失败: ${detail}`,
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
                  onClick={() => setAutoSync(!autoSync)}
                  title={autoSync ? '自动歌单同步中' : '自动歌单同步'}
                >
                  {autoSync ? '自动歌单同步中' : '自动歌单同步'}
                </button>
              )}
            </div>
          </label>
        )}
      </section>

      {/* Toolbar */}
      <section className="border-border-soft bg-bg-elev flex gap-2 border-b px-5 py-3">
        <input
          className="border-border-strong bg-bg-base text-fg-base flex-1 rounded border px-2.5 py-1.5"
          type="text"
          placeholder="手动点歌"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onManualAdd()}
        />
        <button className={btnBase} onClick={onManualAdd}>
          添加
        </button>
        {activeTab === 'songs' ? (
          <>
            <button className={btnBase} onClick={onCopyAll} disabled={display.length === 0}>
              复制列表 ({display.length})
            </button>
            <button className={btnBase} onClick={onClearList} disabled={display.length === 0}>
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

      {/* Tabs */}
      <nav className="border-border-medium bg-bg-elev flex shrink-0 border-b px-5">
        {(['songs', 'played', 'blacklist'] as const).map((tab) => {
          const labels = {
            songs: `点歌列表 (${display.length})`,
            played: `已点歌单 (${played.length})`,
            blacklist: `黑名单 (${blacklist.size})`,
          };
          return (
            <button
              key={tab}
              className={[
                'cursor-pointer border-none bg-transparent px-5 py-2.5 text-sm font-medium transition-colors',
                '-mb-px border-b-2',
                activeTab === tab
                  ? 'text-accent border-accent'
                  : 'text-fg-muted hover:text-fg-base border-transparent',
              ].join(' ')}
              onClick={() => setActiveTab(tab)}
            >
              {labels[tab]}
            </button>
          );
        })}
      </nav>

      {/* Tab content */}
      {activeTab === 'songs' ? (
        <SongList
          songs={display}
          emptyText={running ? '等待点歌...' : '点击 "开始" 连接直播间'}
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
          onContextMenu={openCtxMenu}
        />
      ) : activeTab === 'played' ? (
        <SongList
          songs={played}
          emptyText="暂无已点歌曲"
          headerLabels={{ uname: '添加时间', song: '已点歌曲', actions: '操作' }}
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
                ) : entry?.status === 'pending' ? (
                  <div className="song-status">⋯ 搜索中</div>
                ) : entry?.status === 'not_found' ? (
                  <div className="song-status">未找到</div>
                ) : (
                  <div className="song-status"></div>
                )}
              </div>
            );
          }}
          onContextMenu={openCtxMenu}
        />
      ) : (
        <BlacklistPanel
          items={Array.from(blacklist)}
          onRemove={(name) => {
            removeBlacklist(name);
            showToast(`已移出黑名单: ${name}`);
          }}
        />
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          song={ctxMenu.song}
          items={ctxActions}
          onClose={closeCtxMenu}
        />
      )}

      {/* Logs */}
      <details className="border-border-soft text-fg-muted bg-bg-base max-h-[220px] overflow-y-auto border-t text-xs">
        <summary className="logs-summary border-border-soft bg-bg-softer text-fg-base sticky top-0 z-10 cursor-pointer list-none border-b px-5 py-1.5 select-none">
          日志 ({logs.length})
        </summary>
        <pre className="m-0 px-5 py-1.5 break-all whitespace-pre-wrap">{logs.join('\n')}</pre>
      </details>

      {/* Toast */}
      {toast && (
        <div
          className={[
            'fixed bottom-6 left-1/2 z-[1000] -translate-x-1/2 cursor-pointer rounded-md px-5 py-2.5 text-[13px] whitespace-nowrap text-white hover:opacity-85',
            toast.kind === 'success' ? 'bg-success' : 'bg-danger',
          ].join(' ')}
          style={{
            boxShadow: 'var(--shadow-toast)',
            animation: 'toast-in 0.18s ease-out, toast-out 0.3s ease-in 1.3s forwards',
          }}
          onClick={() => setToast(null)}
          title="Click to dismiss"
        >
          {toast.msg}
        </div>
      )}

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} onShowToast={showToast} />}
      {showKgLogin && <KugouLoginModal onClose={() => setShowKgLogin(false)} />}
      {showKgDebug && <KugouDebugModal onClose={() => setShowKgDebug(false)} />}
    </div>
  );
}
