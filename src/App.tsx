import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore, dedupedSongs } from './store';
import { loadConfig, saveConfig, insertHistory, deleteHistoryByMsgId, clearSessionHistory, loadKugouSession } from './db';
import type { SidecarEvent } from './types';
import { checkForUpdate, openInBrowser, skipVersion, type UpdateInfo } from './updater';
import { AboutModal } from './AboutModal';
import { KugouDebugModal } from './KugouDebugModal';
import { applyTheme, loadTheme, nextTheme, saveTheme, themeIcon, themeLabel, type Theme } from './theme';
import {
  refreshTokenIfStale,
  resolvePlaylistByName,
  searchKuGouTopHit,
  addTrackToPlaylist,
  type KuGouTrack,
} from './kugouSession';

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

  const [manualText, setManualText] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showKgDebug, setShowKgDebug] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme());
  // KuGou login state — drives whether playlist target row + per-row 酷狗
  // buttons are visible. We re-check whenever the dev modal closes so it
  // updates immediately after a fresh QR scan.
  const [kugouLoggedIn, setKugouLoggedIn] = useState(false);

  useEffect(() => {
    loadKugouSession()
      .then((s) => setKugouLoggedIn(Boolean(s.token && s.userid && s.dfid)))
      .catch(() => setKugouLoggedIn(false));
  }, [showKgDebug]);

  // KuGou search results, keyed by trimmed song_name. Each entry is fetched at
  // most once per session — pending while in flight, then frozen as found /
  // not_found / error. The button next to a row reads its status from here.
  const [kugouCache, setKugouCache] = useState<Record<string, KuGouEntry>>({});
  const kugouStartedRef = useRef<Set<string>>(new Set());

  // Apply current theme on mount (in case it was saved before)
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const onCycleTheme = () => {
    const t = nextTheme(theme);
    saveTheme(t);
    setTheme(t);
  };

  // 显示一个 toast, 1.6s 自动消失
  const showToast = (msg: string, kind: 'success' | 'error' = 'success') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 1600);
  };

  const display = useMemo(() => dedupedSongs(songs), [songs]);

  // Pre-fetch KuGou search for each song in the display list (only after
  // login — pre-login the cache stays empty and the row buttons are hidden
  // by the kugouLoggedIn gate). We hit the embedded KuGouMusicApi /search
  // with the user's cookie and cache the top-1 result so a click can
  // immediately add it to the saved target playlist.
  useEffect(() => {
    if (!kugouLoggedIn) return;
    for (const s of display) {
      const name = s.song_name.trim();
      if (!name) continue;
      if (kugouStartedRef.current.has(name)) continue;
      kugouStartedRef.current.add(name);
      setKugouCache((prev) => ({ ...prev, [name]: { status: 'pending' } }));
      searchKuGouTopHit(name)
        .then((track) => {
          setKugouCache((prev) => ({
            ...prev,
            [name]: track ? { status: 'found', track } : { status: 'not_found' },
          }));
        })
        .catch((err) => {
          setKugouCache((prev) => ({
            ...prev,
            [name]: { status: 'error', msg: String(err) },
          }));
        });
    }
  }, [display, kugouLoggedIn]);

  const onAddToPlaylist = async (track: KuGouTrack) => {
    const listid = config.target_playlist_id;
    if (!listid) {
      pushLog('[kugou] add aborted: no target playlist saved');
      showToast('请先在"目标歌单"里保存一个歌单', 'error');
      return;
    }
    pushLog(`[kugou] add → listid=${listid}: ${track.filename}`);
    try {
      await addTrackToPlaylist(track, listid);
      pushLog(`[kugou] added: ${track.filename}`);
      showToast(`已加入歌单: ${track.filename}`);
    } catch (e) {
      pushLog(`[kugou] add failed: ${e}`);
      showToast(`加入歌单失败: ${e}`, 'error');
    }
  };

  // 启动时加载配置
  useEffect(() => {
    (async () => {
      try {
        const cfg = await loadConfig();
        hydrateConfig(cfg);
      } catch (e) {
        setBootError(`加载配置失败: ${e}`);
      }
    })();
  }, [hydrateConfig]);

  // Check Releases for a newer version on startup. Failure is silent.
  useEffect(() => {
    checkForUpdate().then((info) => {
      if (info) setUpdate(info);
    });
  }, []);

  // KuGou token has a long but finite life. Refresh proactively on startup if
  // it's >1 day old so streamers don't bump into auth errors mid-stream.
  // Wait a few seconds first so the kugou-api sidecar has time to come up.
  useEffect(() => {
    const t = window.setTimeout(() => {
      refreshTokenIfStale().catch(() => {});
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  // 订阅 sidecar 事件
  useEffect(() => {
    const unlisten = listen<SidecarEvent>('sidecar-event', (e) => {
      const ev = e.payload;
      switch (ev.event) {
        case 'danmu':
          addSong(ev.data);
          if (sessionId) {
            insertHistory(ev.data, sessionId).catch((err) => pushLog(`db: ${err}`));
          }
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
  }, [addSong, cancelByUid, setStatus, pushLog, sessionId]);

  const onStart = async () => {
    pushLog('[app] start clicked');
    if (!config.room_id.trim()) {
      const msg = '请填写抖音直播间 ID';
      pushLog(`[app] start aborted: ${msg}`);
      setBootError(msg);
      return;
    }
    setBootError(null);
    try {
      await saveConfig(config);
      const sid = newSession();
      clearSongs();
      await clearSessionHistory(sid).catch(() => {});
      await invoke('sidecar_send', { cmd: { cmd: 'start', config } });
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
      pushLog('[app] sidecar stop ack');
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
      pushLog(`[app] copy: ${text}`);
      showToast(`已复制: ${text}`);
    } catch (e) {
      pushLog(`[app] copy failed: ${e}`);
      showToast(`复制失败: ${e}`, 'error');
    }
  };
  const onCopyAll = async () => {
    if (display.length === 0) return;
    try {
      await navigator.clipboard.writeText(display.map((s) => s.song_name).join('\n'));
      pushLog(`[app] copy all: ${display.length} items`);
      showToast(`已复制 ${display.length} 条到剪贴板`);
    } catch (e) {
      pushLog(`[app] copy all failed: ${e}`);
      showToast(`复制失败: ${e}`, 'error');
    }
  };
  const onManualAdd = () => {
    const t = manualText.trim();
    if (!t) return;
    const item = manualAdd(t);
    if (sessionId) insertHistory(item, sessionId).catch(() => {});
    setManualText('');
    pushLog(`[app] manual add: ${t}`);
    showToast(`已添加: ${t}`);
  };
  const onRemoveOne = async (msgId: string, name: string) => {
    removeByMsgId(msgId);
    await deleteHistoryByMsgId(msgId).catch(() => {});
    pushLog(`[app] remove: ${name} (${msgId})`);
    showToast(`已删除: ${name}`);
  };
  const onClearList = async () => {
    const n = display.length;
    clearSongs();
    if (sessionId) await clearSessionHistory(sessionId).catch(() => {});
    pushLog(`[app] cleared ${n} items`);
    showToast(`已清空 ${n} 条`);
  };

  return (
    <div className="app">
      <header className="header">
        <img src="/logo.png" className="header-logo" alt="" />
        <h1>SUSUSongBoard</h1>
        <span className={`status ${status.connected ? 'on' : 'off'}`}>
          {status.connected ? '●' : '○'} {status.message}
        </span>
        <button
          className="header-action header-theme first-tail"
          onClick={onCycleTheme}
          title={`主题: ${themeLabel(theme)} (点击切换)`}
        >
          {themeIcon(theme)}
        </button>
        <button
          className="header-action"
          onClick={() => setShowKgDebug(true)}
          title="KuGou API 调试面板"
        >
          🛠
        </button>
        <button
          className="header-action"
          onClick={() => setShowAbout(true)}
          title="关于 / 检查更新"
        >
          ⓘ
        </button>
      </header>

      {bootError && <div className="banner error">{bootError}</div>}

      {update && (
        <div className="banner update">
          <span>新版本 {update.tag} 可用</span>
          <button onClick={() => openInBrowser(update.htmlUrl)}>前往下载</button>
          <button
            className="dismiss"
            title="跳过此版本，下次启动不再提示（更新版本发布后会重新提示）"
            onClick={() => {
              skipVersion(update.tag);
              setUpdate(null);
            }}
          >
            跳过
          </button>
        </div>
      )}

      <section className="config">
        <label>
          <span>抖音直播间 ID</span>
          <input
            type="text"
            value={config.room_id}
            disabled={running}
            onChange={(e) => setConfig({ room_id: e.target.value })}
            placeholder="例如 221321076494"
          />
        </label>
        <label>
          <span>点歌指令模板</span>
          <input
            type="text"
            value={config.sing_prefix}
            disabled={running}
            onChange={(e) => setConfig({ sing_prefix: e.target.value })}
            placeholder="点歌[space][song]"
            title="Placeholders: [space]=whitespace, [song]=song name. Examples: 点歌:[song] / 点歌[space][song]"
          />
        </label>
        <label>
          <span>最低粉丝团等级</span>
          <input
            type="number"
            min={0}
            value={config.fans_level}
            disabled={running}
            onChange={(e) => setConfig({ fans_level: Number(e.target.value) || 0 })}
          />
        </label>
        <label>
          <span>点歌冷却 (秒)</span>
          <input
            type="number"
            min={0}
            value={config.sing_cd}
            disabled={running}
            onChange={(e) => setConfig({ sing_cd: Math.max(0, Number(e.target.value) || 0) })}
            title="同一用户两次点歌的最短间隔。0 = 关闭冷却。"
          />
        </label>
        {kugouLoggedIn && (
        <label className="playlist-target">
          <span>目标歌单</span>
          <div className="playlist-row">
            <input
              type="text"
              value={config.target_playlist_name}
              onChange={(e) => setConfig({ target_playlist_name: e.target.value })}
              placeholder="自动加入歌单的名字"
            />
            <span className="listid-display">
              {config.target_playlist_id
                ? `id: ${config.target_playlist_id}`
                : 'id: —'}
            </span>
            <button
              type="button"
              onClick={async () => {
                const name = config.target_playlist_name.trim();
                if (!name) {
                  showToast('请先填歌单名', 'error');
                  return;
                }
                pushLog(`[playlist] resolving "${name}"`);
                try {
                  const { listid, created } = await resolvePlaylistByName(name);
                  setConfig({ target_playlist_id: listid });
                  await saveConfig({ ...config, target_playlist_name: name, target_playlist_id: listid });
                  const msg = created
                    ? `已新建歌单 (id: ${listid})`
                    : `已绑定歌单 (id: ${listid})`;
                  pushLog(`[playlist] ${msg}`);
                  showToast(msg);
                } catch (e) {
                  const detail = String(e);
                  pushLog(`[playlist] failed: ${detail}`);
                  if (detail.includes('not logged in')) {
                    showToast('请先点 🛠 扫码登录', 'error');
                  } else {
                    showToast(`解析失败: ${detail}`, 'error');
                  }
                }
              }}
            >
              保存
            </button>
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
        <input
          type="text"
          placeholder="手动点歌"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onManualAdd()}
        />
        <button onClick={onManualAdd}>添加</button>
        <button onClick={onCopyAll} disabled={display.length === 0}>
          复制列表 ({display.length})
        </button>
        <button onClick={onClearList} disabled={display.length === 0}>
          清空
        </button>
      </section>

      <div className="list">
        <div className="list-header">
          <div className="col-uname">用户</div>
          <div className="col-song">点歌</div>
          <div className="col-actions">操作</div>
        </div>
        <div className="list-body">
          {display.length === 0 && (
            <div className="empty">{running ? '等待点歌...' : '点击 "开始" 连接直播间'}</div>
          )}
          {display.map((s) => {
            const entry: KuGouEntry = kugouCache[s.song_name.trim()] ?? { status: 'pending' };
            const hasTarget = config.target_playlist_id > 0;
            let kugouLabel = '🎵 加入歌单';
            let kugouTitle = '';
            let kugouEnabled = entry.status === 'found' && hasTarget;
            switch (entry.status) {
              case 'pending':
                kugouLabel = '🎵 ⋯';
                kugouTitle = '正在 KuGou 查找…';
                break;
              case 'found':
                kugouTitle = hasTarget
                  ? `加入歌单 (id ${config.target_playlist_id}): ${entry.track.filename}`
                  : '请先在"目标歌单"里保存一个歌单';
                break;
              case 'not_found':
                kugouTitle = 'KuGou 未找到这首歌';
                break;
              case 'error':
                kugouTitle = `KuGou 搜索失败: ${entry.msg}`;
                break;
            }
            return (
              <div key={s.msg_id} className="item">
                <div className="col-uname uname">{s.uname}</div>
                <div className="col-song song">{s.song_name}</div>
                <div className="col-actions item-actions">
                  {kugouLoggedIn && (
                    <button
                      disabled={!kugouEnabled}
                      onClick={() => entry.status === 'found' && onAddToPlaylist(entry.track)}
                      title={kugouTitle}
                    >
                      {kugouLabel}
                    </button>
                  )}
                  <button onClick={() => onCopy(s.song_name)}>复制</button>
                  <button onClick={() => onRemoveOne(s.msg_id, s.song_name)}>删除</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <details className="logs">
        <summary>日志 ({logs.length})</summary>
        <pre>{logs.join('\n')}</pre>
      </details>

      {toast && (
        <div
          className={`toast ${toast.kind}`}
          onClick={() => setToast(null)}
          title="Click to dismiss"
        >
          {toast.msg}
        </div>
      )}

      {showAbout && (
        <AboutModal
          onClose={() => setShowAbout(false)}
          onShowToast={showToast}
        />
      )}

      {showKgDebug && <KugouDebugModal onClose={() => setShowKgDebug(false)} />}
    </div>
  );
}
