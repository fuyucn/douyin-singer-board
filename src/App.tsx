import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore, dedupedSongs } from './store';
import { loadConfig, saveConfig, insertHistory, deleteHistoryByMsgId, clearSessionHistory } from './db';
import type { DanmuInfo, SidecarEvent } from './types';
import { checkForUpdate, openInBrowser, skipVersion, type UpdateInfo } from './updater';
import { AboutModal } from './AboutModal';
import { applyTheme, loadTheme, nextTheme, saveTheme, themeIcon, themeLabel, type Theme } from './theme';
import { useBlacklist } from './hooks/useBlacklist';
import { useContextMenu } from './hooks/useContextMenu';
import { SongList } from './components/SongList';
import { BlacklistPanel } from './components/BlacklistPanel';
import { ContextMenu } from './components/ContextMenu';
import { AppLogo } from './components/AppLogo';
import { ConnectionStatus } from './components/ConnectionStatus';

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
  const [theme, setTheme] = useState<Theme>(loadTheme());
  const [activeTab, setActiveTab] = useState<'songs' | 'played' | 'blacklist'>('songs');

  useEffect(() => { applyTheme(theme); }, [theme]);

  const showToast = (msg: string, kind: 'success' | 'error' = 'success') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 1600);
  };

  const display = useMemo(() => dedupedSongs(songs), [songs]);

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

  const onAddToPlayed = (song: DanmuInfo) => {
    removeByMsgId(song.msg_id);
    addPlayed(song);
    deleteHistoryByMsgId(song.msg_id).catch(() => {});
    showToast(`已点: ${song.song_name}`);
  };

  // ─── Render helpers ───────────────────────────────────────────

  const renderSongActions = (s: DanmuInfo) => (
    <>
      <button onClick={() => onAddToPlayed(s)}>已点</button>
      <button onClick={() => onCopy(s.song_name)}>复制</button>
      <button onClick={() => onRemoveOne(s.msg_id, s.song_name)}>删除</button>
    </>
  );

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
        <AppLogo />
        <h1>SUSUSongBoard</h1>
        <ConnectionStatus />
        <button className="header-action header-theme first-tail" onClick={() => { const t = nextTheme(theme); saveTheme(t); setTheme(t); }} title={`主题: ${themeLabel(theme)}`}>
          {themeIcon(theme)}
        </button>
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
          headerLabels={{ uname: '添加时间', song: '已点歌曲', actions: '操作' }}
          renderActions={renderPlayedActions}
          renderUname={(s) => {
            const ts = s.played_at ?? s.send_time;
            const d = new Date(ts * 1000);
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          }}
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
    </div>
  );
}
