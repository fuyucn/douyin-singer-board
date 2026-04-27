// Developer panel for exercising the embedded KuGouMusicApi server. The four
// buttons cover the workflow we need to validate (login → list playlists →
// search → add) before investing in a real QR-login UX.

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  onClose: () => void;
}

interface ApiResult {
  status: number;
  body: any;
}

const COOKIE_KEY = 'sususongboard.kugou-cookie';

async function call(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<ApiResult> {
  return invoke<ApiResult>('kugou_api_request', { method, path, cookie, body });
}

type QrState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'waiting'; key: string; image: string; statusLabel: string }
  | { kind: 'error'; msg: string };

export function KugouDebugModal({ onClose }: Props) {
  const [cookie, setCookie] = useState<string>(() => {
    try {
      return localStorage.getItem(COOKIE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [keyword, setKeyword] = useState('海阔天空');
  const [listid, setListid] = useState('');
  const [songData, setSongData] = useState(''); // name|hash|album_id|mixsongid
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; data: ApiResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<QrState>({ kind: 'idle' });
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [onClose]);

  const persistCookie = (value: string) => {
    try {
      localStorage.setItem(COOKIE_KEY, value);
    } catch {}
  };

  const run = async (label: string, fn: () => Promise<ApiResult>) => {
    setBusy(label);
    setError(null);
    try {
      const data = await fn();
      setResult({ label, data });
    } catch (e) {
      setError(`${label} failed: ${e}`);
    } finally {
      setBusy(null);
    }
  };

  const onUserDetail = () =>
    run('GET /user/detail', () => call('GET', '/user/detail', cookie));

  const onListPlaylists = () =>
    run('GET /user/playlist', () => call('GET', '/user/playlist?pagesize=100', cookie));

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
      if (!image) {
        setQr({ kind: 'error', msg: '/login/qr/create 没返回 base64 图片' });
        return;
      }
      setQr({ kind: 'waiting', key, image, statusLabel: '等待手机扫码' });

      pollRef.current = window.setInterval(async () => {
        try {
          const r = await call('GET', `/login/qr/check?key=${encodeURIComponent(key)}`, '');
          const data = r.body?.data ?? {};
          const code = Number(data.status ?? -1);
          if (code === 4) {
            stopPoll();
            const token = String(data.token ?? '');
            const userid = String(data.userid ?? '');
            if (!token || !userid) {
              setQr({ kind: 'error', msg: '登录返回未含 token/userid，原始响应见下方结果' });
              setResult({ label: '扫码登录响应', data: r });
              return;
            }
            const cookieStr = `token=${token};userid=${userid}`;
            setCookie(cookieStr);
            persistCookie(cookieStr);
            setQr({ kind: 'idle' });
            setResult({ label: '扫码登录成功 (token/userid 已写入)', data: r });
          } else if (code === 0) {
            stopPoll();
            setQr({ kind: 'error', msg: '二维码已过期，请重新扫码' });
          } else {
            const labels: Record<number, string> = {
              1: '等待手机扫码',
              2: '已扫码，等待手机确认',
            };
            setQr((prev) =>
              prev.kind === 'waiting'
                ? { ...prev, statusLabel: labels[code] ?? `status=${code}` }
                : prev,
            );
          }
        } catch (e) {
          // transient — keep polling
          console.warn('qr check err', e);
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
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="kg-actions">
            <button onClick={startQrLogin} disabled={qr.kind === 'loading' || qr.kind === 'waiting'}>
              {qr.kind === 'loading' ? '生成二维码中…' : '扫码登录 (KuGou 手机 App)'}
            </button>
            {(qr.kind === 'waiting' || qr.kind === 'error') && (
              <button onClick={cancelQr}>取消</button>
            )}
          </div>

          {qr.kind === 'waiting' && (
            <div className="kg-qr">
              <img src={qr.image} alt="KuGou QR" />
              <div className="kg-qr-status">{qr.statusLabel}</div>
            </div>
          )}
          {qr.kind === 'error' && <div className="kg-status error">QR: {qr.msg}</div>}

          <label className="kg-row">
            <span className="label">Cookie</span>
            <textarea
              className="kg-cookie"
              rows={3}
              placeholder="扫码登录后会自动填好；或者手动粘贴 token=xxx;userid=yyy 格式"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              onBlur={() => persistCookie(cookie)}
            />
          </label>

          <div className="kg-actions">
            <button onClick={onUserDetail} disabled={!cookie || busy !== null}>
              测试登录 (/user/detail)
            </button>
            <button onClick={onListPlaylists} disabled={!cookie || busy !== null}>
              列我的歌单 (/user/playlist)
            </button>
          </div>

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
              </summary>
              <pre>{JSON.stringify(result.data.body, null, 2)}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
