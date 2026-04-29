import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore, dedupedSongs } from './store';
import { loadConfig, saveConfig, insertHistory, deleteHistoryByMsgId, clearSessionHistory, loadKugouSession } from './db';
import type { DanmuInfo, SidecarEvent } from './types';
import { checkForUpdate, openInBrowser, skipVersion, type UpdateInfo } from './updater';
import { AboutModal } from './AboutModal';
import { KugouDebugModal } from './KugouDebugModal';
import { applyTheme, loadTheme, nextTheme, saveTheme, themeIcon, themeLabel, type Theme } from './theme';
import {
  refreshTokenIfStale,
  resolvePlaylistByName,
  searchKuGouPreferredHit,
  searchKuGouTopHit,
  listenHistoryMap,
  addTrackToPlaylist,
  type KuGouTrack,
} from './kugouSession';
import { useBlacklist } from './hooks/useBlacklist';
import { useContextMenu } from './hooks/useContextMenu';
import { SongList } from './components/SongList';
import { BlacklistPanel } from './components/BlacklistPanel';
import { ContextMenu } from './components/ContextMenu';

type KuGouEntry =
  | { status: 'pending' }
  | { status: 'found'; track: KuGouTrack }
  | { status: 'not_found' }
  | { status: 'error'; msg: string };

export default function App() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const hydrateConfig = useAppStore((s) => s.hydrateConfig);
  const running = useAppStore((s) => s.running);
  const setRunning = useAppStore((s) => s.setRunning);
  const sessionId = useAppStore((s) => s.sessionId);
  const newSession = useAppStore((s) => s.newSession);
  const status = useAppStore((s) => s.status);
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
  const played = useAppStore((s) => s.played);
  const addPlayed = useAppStore((s) => s.addPlayed);
  const clearPlayed = useAppStore((s) => s.clearPlayed);

  const { blacklist, add: addBlacklist, remove: removeBlacklist, getNames: getBlacklistNames } = useBlacklist();
  const { ctxMenu, open: openCtxMenu, close: closeCtxMenu } = useContextMenu();

  const [manualText, setManualText] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showKgDebug, setShowKgDebug] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme());
  const [activeTab, setActiveTab] = useState<'songs' | 'played' | 'blacklist'>('songs');
  const [kugouLoggedIn, setKugouLoggedIn] = useState(false);

  useEffect(() => {
    loadKugouSession()
      .then((s) => setKugouLoggedIn(Boolean(s.token && s.userid && s.dfid)))
      .catch(() => setKugouLoggedIn(false));
  }, [showKgDebug]);

  useEffect(() => {
    if (!kugouLoggedIn) return;
    listenHistoryMap()
      .then((m) => pushLog(`[kugou] listen history cached: ${m.size} hashes`))
      .catch((e) => pushLog(`[kugou] listen history failed: ${e}`));
  }, [kugouLoggedIn, pushLog]);

  // KuGou search cache
  const [kugouCache, setKugouCache] = useState<Record<string, KuGouEntry>>({});
  const kugouStartedRef = useRef<Set<string>>(new Set());

  useEffect(() => { applyTheme(theme); }, [theme]);

  const showToast = (msg: string, kind: 'success' | 'error' = 'success') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 1600);
  };

  const display = useMemo(() => dedupedSongs(songs), [songs]);

  // Pre-fetch KuGou search
  useEffect(() => {
    if (!kugouLoggedIn) return;
    for (const s of display) {
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
  }, [display, kugouLoggedIn, preferCumulative]);

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
    checkForUpdate().then((info) => { if (info) setUpdate(info); });
  }, []);

  // Startup: Kugou token refresh
  useEffect(() => {
    const t = window.setTimeout(() => { refreshTokenIfStale().catch(() => {}); }, 4000);
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
    return () => { unlisten.then((fn) => fn()); };
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
      await invoke('sidecar_send', { cmd: { cmd: 'start', config: { ...config, blacklist: blNames } } });
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
      showToast('请先在"目标歌单"里保存一个歌单', 'error');
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

  // ─── Render helpers ───────────────────────────────────────────

  const renderSongActions = (s: DanmuInfo) => {
    const entry: KuGouEntry = kugouCache[s.song_name.trim()] ?? { status: 'pending' };
    const hasTarget = config.target_playlist_id > 0;
    let label = '🎵 加入歌单';
    let title = '';
    let enabled = entry.status === 'found' && hasTarget;
    switch (entry.status) {
      case 'pending': label = '🎵 ⋯'; title = '正在 KuGou 查找…'; break;
      case 'found': title = hasTarget ? `加入歌单: ${entry.track.filename}` : '请先保存目标歌单'; break;
      case 'not_found': title = 'KuGou 未找到这首歌'; break;
      case 'error': title = `KuGou 搜索失败: ${entry.msg}`; break;
    }
    return (
      <>
        {kugouLoggedIn && (
          <button disabled={!enabled} onClick={() => entry.status === 'found' && onAddToPlaylist(entry.track, s)} title={title}>
            {label}
          </button>
        )}
        <button onClick={() => onCopy(s.song_name)}>复制</button>
        <button onClick={() => onRemoveOne(s.msg_id, s.song_name)}>删除</button>
      </>
    );
  };

  const renderPlayedActions = (s: DanmuInfo) => (
    <button onClick={() => onCopy(s.song_name)}>复制</button>
  );

  const ctxActions = ctxMenu ? [
    { label: '复制歌名', onClick: () => onCopy(ctxMenu.song.song_name) },
    { label: '删除', onClick: () => onRemoveOne(ctxMenu.song.msg_id, ctxMenu.song.song_name) },
    { label: '加入黑名单', onClick: () => {
      addBlacklist(ctxMenu.song.song_name, ctxMenu.song.msg_id);
      showToast(`已加入黑名单: ${ctxMenu.song.song_name}`);
    }},
  ] : [];

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="app">
      <header className="header">
        <img src="/logo.png" className="header-logo" alt="" />
        <h1>SUSUSongBoard</h1>
        <span className={`status ${status.connected ? 'on' : 'off'}`}>
          {status.connected ? '●' : '○'} {status.message}
        </span>
        <button className="header-action header-theme first-tail" onClick={() => { const t = nextTheme(theme); saveTheme(t); setTheme(t); }} title={`主题: ${themeLabel(theme)}`}>
          {themeIcon(theme)}
        </button>
        <button className="header-action" onClick={() => setShowKgDebug(true)} title="KuGou API 调试面板">🛠</button>
        <button className="header-action" onClick={() => setShowAbout(true)} title="关于 / 检查更新">ⓘ</button>
      </header>

      {bootError && <div className="banner error">{bootError}</div>}

      {update && (
        <div className="banner update">
          <span>新版本 {update.tag} 可用</span>
          <button onClick={() => openInBrowser(update.htmlUrl)}>前往下载</button>
          <button className="dismiss" onClick={() => { skipVersion(update.tag); setUpdate(null); }}>跳过</button>
        </div>
      )}

      <section className="config">
        <label>
          <span>抖音直播间 ID</span>
          <input type="text" value={config.room_id} disabled={running} onChange={(e) => setConfig({ room_id: e.target.value })} placeholder="例如 221321076494" />
        </label>
        <label>
          <span>点歌指令模板</span>
          <input type="text" value={config.sing_prefix} disabled={running} onChange={(e) => setConfig({ sing_prefix: e.target.value })} placeholder="点歌[space][song]" title="Placeholders: [space]=whitespace, [song]=song name" />
        </label>
        <label>
          <span>最低粉丝团等级</span>
          <input type="number" min={0} value={config.fans_level} disabled={running} onChange={(e) => setConfig({ fans_level: Number(e.target.value) || 0 })} />
        </label>
        <label>
          <span>点歌冷却 (秒)</span>
          <input type="number" min={0} value={config.sing_cd} disabled={running} onChange={(e) => setConfig({ sing_cd: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        {kugouLoggedIn && (
        <label className="playlist-target">
          <span>目标歌单</span>
          <div className="playlist-row">
            <input type="text" value={config.target_playlist_name} onChange={(e) => setConfig({ target_playlist_name: e.target.value })} placeholder="自动加入歌单的名字" />
            <span className="listid-display">{config.target_playlist_id ? `id: ${config.target_playlist_id}` : 'id: —'}</span>
            <button type="button" onClick={async () => {
              const name = config.target_playlist_name.trim();
              if (!name) { showToast('请先填歌单名', 'error'); return; }
              try {
                const { listid, created } = await resolvePlaylistByName(name);
                setConfig({ target_playlist_id: listid });
                await saveConfig({ ...config, target_playlist_name: name, target_playlist_id: listid });
                showToast(created ? `已新建歌单 (id: ${listid})` : `已绑定歌单 (id: ${listid})`);
              } catch (e) {
                const detail = String(e);
                showToast(detail.includes('not logged in') ? '请先点 🛠 扫码登录' : `解析失败: ${detail}`, 'error');
              }
            }}>保存</button>
          </div>
        </label>
        )}
        {!running ? (
          <button className="primary" onClick={onStart}>开始</button>
        ) : (
          <button className="danger" onClick={onStop}>停止</button>
        )}
      </section>

      <section className="toolbar">
        <input type="text" placeholder="手动点歌" value={manualText} onChange={(e) => setManualText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onManualAdd()} />
        <button onClick={onManualAdd}>添加</button>
        {activeTab === 'songs' ? (
          <>
            <button onClick={onCopyAll} disabled={display.length === 0}>复制列表 ({display.length})</button>
            <button onClick={onClearList} disabled={display.length === 0}>清空</button>
          </>
        ) : activeTab === 'played' ? (
          <span className="toolbar-hint">已点歌曲列表，当前 session 有效</span>
        ) : (
          <span className="toolbar-hint">黑名单中的歌曲不会被匹配到</span>
        )}
      </section>

      <nav className="tab-nav">
        <button className={`tab-btn ${activeTab === 'songs' ? 'active' : ''}`} onClick={() => setActiveTab('songs')}>点歌列表 ({display.length})</button>
        <button className={`tab-btn ${activeTab === 'played' ? 'active' : ''}`} onClick={() => setActiveTab('played')}>已点歌单 ({played.length})</button>
        <button className={`tab-btn ${activeTab === 'blacklist' ? 'active' : ''}`} onClick={() => setActiveTab('blacklist')}>黑名单 ({blacklist.size})</button>
      </nav>

      {activeTab === 'songs' ? (
        <SongList
          songs={display}
          emptyText={running ? '等待点歌...' : '点击 "开始" 连接直播间'}
          renderActions={renderSongActions}
          onContextMenu={openCtxMenu}
        />
      ) : activeTab === 'played' ? (
        <SongList
          songs={played}
          emptyText="暂无已点歌曲"
          headerLabels={{ uname: '用户', song: '已点歌曲', actions: '操作' }}
          renderActions={renderPlayedActions}
          onContextMenu={openCtxMenu}
        />
      ) : (
        <BlacklistPanel items={Array.from(blacklist)} onRemove={(name) => { removeBlacklist(name); showToast(`已移出黑名单: ${name}`); }} />
      )}

      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} song={ctxMenu.song} items={ctxActions} onClose={closeCtxMenu} />}

      <details className="logs">
        <summary>日志 ({logs.length})</summary>
        <pre>{logs.join('\n')}</pre>
      </details>

      {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)} title="Click to dismiss">{toast.msg}</div>}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} onShowToast={showToast} />}
      {showKgDebug && <KugouDebugModal onClose={() => setShowKgDebug(false)} />}
    </div>
  );
}
