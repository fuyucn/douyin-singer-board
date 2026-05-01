// Developer panel for exercising the embedded KuGouMusicApi server. The four
// buttons cover the workflow we need to validate (login → list playlists →
// search → add) before investing in a real QR-login UX.

import { useEffect, useRef, useState } from 'react';
import { loadKugouSession, saveKugouSession, clearKugouSession, sessionToCookie } from './db';
import { ensureDeviceRegistered, refreshToken, saveLogin, call } from './kugouSession';
import { useAppStore } from './store';

interface Props {
  onClose: () => void;
}

interface ApiResult {
  status: number;
  body: any;
}

type QrState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'waiting';
      key: string;
      image: string;
      qrUrl: string;
      statusLabel: string;
      pollCount: number;
      lastResp: ApiResult | null;
    }
  | { kind: 'error'; msg: string };

export function KugouDebugModal({ onClose }: Props) {
  const pushLog = useAppStore((s) => s.pushLog);
  const preferCumulative = useAppStore((s) => s.preferCumulative);
  const setPreferCumulative = useAppStore((s) => s.setPreferCumulative);
  const [cookie, setCookie] = useState<string>('');
  const [refreshedAt, setRefreshedAt] = useState<number>(0);
  const [keyword, setKeyword] = useState('海阔天空');
  const [listid, setListid] = useState('');
  const [songData, setSongData] = useState(''); // name|hash|album_id|mixsongid
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; data: ApiResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<QrState>({ kind: 'idle' });
  const pollRef = useRef<number | null>(null);

  // Hydrate cookie from SQLite on mount so previous logins survive restarts.
  useEffect(() => {
    loadKugouSession()
      .then((s) => {
        setCookie(sessionToCookie(s));
        setRefreshedAt(s.refreshed_at);
      })
      .catch((e) => setError(`load session: ${e}`));
  }, []);

  // Keydown listener — re-binds when onClose changes. Must NOT touch
  // pollRef in cleanup, otherwise every parent re-render kills our
  // setInterval (parent passes a fresh arrow each render).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Mount-only cleanup so we don't strand the QR poll interval when the
  // modal actually unmounts.
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  const refreshFromDb = async () => {
    const s = await loadKugouSession();
    setCookie(sessionToCookie(s));
    setRefreshedAt(s.refreshed_at);
  };

  const run = async (label: string, fn: () => Promise<ApiResult>) => {
    setBusy(label);
    setError(null);
    pushLog(`[kg-dev] ${label} →`);
    try {
      const data = await fn();
      pushLog(`[kg-dev] ${label} ← status=${data.status}`);
      setResult({ label, data });
    } catch (e) {
      pushLog(`[kg-dev] ${label} ERR: ${e}`);
      setError(`${label} failed: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onRegisterDev = async () => {
    setBusy('register/dev');
    setError(null);
    try {
      // Force re-register: clear stored dfid first so ensureDeviceRegistered
      // actually hits the upstream call again, then refresh from DB.
      await saveKugouSession({ dfid: '' });
      const dfid = await ensureDeviceRegistered();
      await refreshFromDb();
      setResult({
        label: 'register/dev',
        data: { status: dfid ? 200 : 0, body: { dfid } },
      });
    } catch (e) {
      setError(`register/dev failed: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onRefreshToken = async () => {
    setBusy('login/token');
    setError(null);
    try {
      const newToken = await refreshToken();
      await refreshFromDb();
      setResult({
        label: 'login/token (refreshed)',
        data: { status: 200, body: { token: newToken } },
      });
    } catch (e) {
      setError(`token refresh failed: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onLogout = async () => {
    await clearKugouSession();
    await refreshFromDb();
    setResult(null);
    setError(null);
  };

  const onUserDetail = () => run('GET /user/detail', () => call('GET', '/user/detail', cookie));

  const onListPlaylists = () =>
    run('GET /user/playlist', () => call('GET', '/user/playlist?pagesize=100', cookie));

  const onUserListen = () =>
    run('GET /user/listen?type=1', () => call('GET', '/user/listen?type=1', cookie));

  const onUserHistory = () => run('GET /user/history', () => call('GET', '/user/history', cookie));

  const onSearch = () =>
    run('GET /search', () =>
      call('GET', `/search?keywords=${encodeURIComponent(keyword)}&pagesize=5`, cookie),
    );

  const onAddTrack = () => {
    if (!listid.trim()) {
      setError('listid required');
      return;
    }
    if (!songData.trim()) {
      setError('songData required (name|hash|album_id|mixsongid)');
      return;
    }
    return run('GET /playlist/tracks/add', () =>
      call(
        'GET',
        `/playlist/tracks/add?listid=${encodeURIComponent(listid)}&data=${encodeURIComponent(songData)}`,
        cookie,
      ),
    );
  };

  const stopPoll = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // KuGou QR login: get a key, render the QR image, poll for the user to scan
  // with the KuGou mobile app and confirm. On status=4 the response carries
  // the token + userid we need — we wire them into the cookie field so the
  // four buttons below light up immediately.
  const startQrLogin = async () => {
    setError(null);
    setQr({ kind: 'loading' });
    try {
      const keyResp = await call('GET', '/login/qr/key', '');
      const key = String(keyResp.body?.data?.qrcode ?? '');
      if (!key) {
        setQr({ kind: 'error', msg: `/login/qr/key 没返回 qrcode (status ${keyResp.status})` });
        return;
      }
      const createResp = await call(
        'GET',
        `/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true`,
        '',
      );
      const image = String(createResp.body?.data?.base64 ?? '');
      const qrUrl = String(createResp.body?.data?.url ?? '');
      if (!image) {
        setQr({ kind: 'error', msg: '/login/qr/create 没返回 base64 图片' });
        return;
      }
      setQr({
        kind: 'waiting',
        key,
        image,
        qrUrl,
        statusLabel: '等待手机扫码',
        pollCount: 0,
        lastResp: null,
      });

      pollRef.current = window.setInterval(async () => {
        try {
          const r = await call('GET', `/login/qr/check?key=${encodeURIComponent(key)}`, '');
          // Always surface the latest response so we can see what KuGou is
          // saying even when our parser doesn't find what it expects.
          setResult({ label: `/login/qr/check`, data: r });

          const data = r.body?.data ?? {};
          const rawStatus = data.status;
          const code = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus ?? -1);

          if (code === 4) {
            stopPoll();
            const token = String(data.token ?? r.body?.token ?? '');
            const userid = String(data.userid ?? r.body?.userid ?? '');
            if (!token || !userid) {
              setQr({
                kind: 'error',
                msg: 'status=4 but no token/userid (see 结果 panel below)',
              });
              return;
            }

            // Persist the new login + register the device on first login. The
            // dfid is sticky across restarts so we won't hit /register/dev
            // again after this — even on a fresh launch.
            await saveLogin(token, userid);
            try {
              const dfid = await ensureDeviceRegistered();
              setResult({
                label: 'login complete (dfid acquired)',
                data: { status: 200, body: { dfid } },
              });
            } catch (e) {
              setError(`register/dev 失败: ${e}`);
            }
            await refreshFromDb();
            setQr({ kind: 'idle' });
            return;
          }
          if (code === 0) {
            stopPoll();
            setQr({ kind: 'error', msg: '二维码已过期，请重新扫码' });
            return;
          }

          const labels: Record<number, string> = {
            1: '等待手机扫码',
            2: '已扫码，等待手机确认',
          };
          setQr((prev) =>
            prev.kind === 'waiting'
              ? {
                  ...prev,
                  statusLabel: labels[code] ?? `status=${code} raw=${JSON.stringify(rawStatus)}`,
                  pollCount: prev.pollCount + 1,
                  lastResp: r,
                }
              : prev,
          );
        } catch (e) {
          setError(`qr check err: ${e}`);
          setQr((prev) =>
            prev.kind === 'waiting' ? { ...prev, pollCount: prev.pollCount + 1 } : prev,
          );
        }
      }, 2500);
    } catch (e) {
      setQr({ kind: 'error', msg: String(e) });
    }
  };

  const cancelQr = () => {
    stopPoll();
    setQr({ kind: 'idle' });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal kg-debug" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>KuGou API 调试面板</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="kg-actions">
            <button
              onClick={startQrLogin}
              disabled={qr.kind === 'loading' || qr.kind === 'waiting'}
            >
              {qr.kind === 'loading' ? '生成二维码中…' : '扫码登录 (KuGou 手机 App)'}
            </button>
            {(qr.kind === 'waiting' || qr.kind === 'error') && (
              <button onClick={cancelQr}>取消</button>
            )}
          </div>

          {qr.kind === 'waiting' && (
            <div className="kg-qr">
              <img src={qr.image} alt="KuGou QR" />
              <div className="kg-qr-status">
                {qr.statusLabel}（已轮询 {qr.pollCount} 次）
              </div>
              {qr.qrUrl && (
                <div className="kg-qr-url">
                  <code title={qr.qrUrl}>{qr.qrUrl}</code>
                  <button
                    className="link inline"
                    onClick={() => navigator.clipboard.writeText(qr.qrUrl)}
                  >
                    复制
                  </button>
                </div>
              )}
              <div className="kg-qr-help">
                提示：用 <b>酷狗音乐 App</b>（不是概念版/微信小程序）扫码；如果不响应，
                试试用手机浏览器直接打开上面 URL 看 H5 页面是否正常。
              </div>
            </div>
          )}
          {qr.kind === 'error' && <div className="kg-status error">QR: {qr.msg}</div>}

          <label className="kg-row">
            <span className="label">Cookie</span>
            <textarea
              className="kg-cookie"
              rows={3}
              placeholder="扫码登录后自动持久化到 SQLite。手动编辑可改 token / userid / dfid"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              onBlur={async () => {
                // Parse the textarea back into KugouSession fields and persist.
                const parsed: Record<string, string> = {};
                cookie.split(';').forEach((p) => {
                  const idx = p.indexOf('=');
                  if (idx > 0) {
                    parsed[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
                  }
                });
                await saveKugouSession({
                  token: parsed.token ?? '',
                  userid: parsed.userid ?? '',
                  dfid: parsed.dfid ?? '',
                });
              }}
            />
          </label>

          <div className="kg-status">
            {refreshedAt > 0
              ? `登录态已持久化 — token 上次刷新: ${new Date(refreshedAt * 1000).toLocaleString()}`
              : '未登录'}
          </div>

          <div className="kg-actions">
            <button onClick={onRefreshToken} disabled={!cookie || busy !== null}>
              刷新 Token (/login/token)
            </button>
            <button onClick={onRegisterDev} disabled={!cookie || busy !== null}>
              重新注册设备 (/register/dev)
            </button>
            <button onClick={onLogout} disabled={!cookie || busy !== null}>
              清空 session
            </button>
          </div>

          <div className="kg-actions">
            <button onClick={onUserDetail} disabled={!cookie || busy !== null}>
              测试登录 (/user/detail)
            </button>
            <button onClick={onListPlaylists} disabled={!cookie || busy !== null}>
              列我的歌单 (/user/playlist)
            </button>
            <button onClick={onUserListen} disabled={!cookie || busy !== null}>
              累计播放榜 (/user/listen?type=1)
            </button>
            <button onClick={onUserHistory} disabled={!cookie || busy !== null}>
              最近播放流水 (/user/history)
            </button>
          </div>

          <label className="kg-switch">
            <input
              type="checkbox"
              checked={preferCumulative}
              onChange={(e) => {
                setPreferCumulative(e.target.checked);
                pushLog(`[kg-dev] 累计播放优先 = ${e.target.checked ? 'on' : 'off'}`);
              }}
            />
            <span>累计播放优先（用 /user/listen 历史挑版本，关闭则取搜索首条）</span>
          </label>

          <div className="kg-row inline">
            <span className="label">关键词</span>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            <button onClick={onSearch} disabled={!cookie || busy !== null}>
              搜索 (/search)
            </button>
          </div>

          <div className="kg-row inline">
            <span className="label">listid</span>
            <input
              value={listid}
              onChange={(e) => setListid(e.target.value)}
              placeholder="从「列我的歌单」结果里挑一个 listid"
            />
          </div>
          <div className="kg-row inline">
            <span className="label">data</span>
            <input
              value={songData}
              onChange={(e) => setSongData(e.target.value)}
              placeholder="name|hash|album_id|mixsongid (从搜索结果拼)"
            />
            <button onClick={onAddTrack} disabled={!cookie || busy !== null}>
              加入歌单 (/playlist/tracks/add)
            </button>
          </div>

          {busy && <div className="kg-status">⋯ {busy}</div>}
          {error && <div className="kg-status error">{error}</div>}

          {result && (
            <details className="kg-result" open>
              <summary>
                {result.label} → status {result.data.status}
                <button
                  className="kg-copy"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const json = JSON.stringify(result.data.body, null, 2);
                    navigator.clipboard
                      .writeText(json)
                      .then(() => pushLog(`[kg-dev] copied ${json.length} chars`))
                      .catch((err) => pushLog(`[kg-dev] copy failed: ${err}`));
                  }}
                >
                  复制
                </button>
              </summary>
              <pre>{JSON.stringify(result.data.body, null, 2)}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
