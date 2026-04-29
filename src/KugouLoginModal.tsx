import { useEffect, useRef, useState } from 'react';
import {
  loadKugouSession,
  clearKugouSession,
} from './db';
import { call, ensureDeviceRegistered, saveLogin } from './kugouSession';

interface Props {
  onClose: () => void;
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
    }
  | { kind: 'error'; msg: string };

export function KugouLoginModal({ onClose }: Props) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [userid, setUserid] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [qr, setQr] = useState<QrState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const refreshFromDb = async () => {
    const s = await loadKugouSession();
    setLoggedIn(Boolean(s.token && s.userid));
    setUserid(s.userid ?? '');
    setRefreshedAt(s.refreshed_at);
  };

  useEffect(() => {
    refreshFromDb();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  const stopPoll = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startQrLogin = async () => {
    setQr({ kind: 'loading' });
    try {
      const keyResp = await call('GET', '/login/qr/key', '');
      const key = String(keyResp.body?.data?.qrcode ?? '');
      if (!key) {
        setQr({ kind: 'error', msg: '获取二维码失败，请重试' });
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
        setQr({ kind: 'error', msg: '生成二维码失败，请重试' });
        return;
      }
      setQr({
        kind: 'waiting',
        key,
        image,
        qrUrl,
        statusLabel: '等待手机扫码',
        pollCount: 0,
      });

      pollRef.current = window.setInterval(async () => {
        try {
          const r = await call('GET', `/login/qr/check?key=${encodeURIComponent(key)}`, '');
          const data = r.body?.data ?? {};
          const rawStatus = data.status;
          const code = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus ?? -1);

          if (code === 4) {
            stopPoll();
            const token = String(data.token ?? r.body?.token ?? '');
            const uid = String(data.userid ?? r.body?.userid ?? '');
            if (!token || !uid) {
              setQr({ kind: 'error', msg: '登录失败：未获取到账号信息' });
              return;
            }
            await saveLogin(token, uid);
            try { await ensureDeviceRegistered(); } catch {}
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
              ? { ...prev, statusLabel: labels[code] ?? `状态: ${code}`, pollCount: prev.pollCount + 1 }
              : prev,
          );
        } catch {
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

  const onLogout = async () => {
    setBusy(true);
    await clearKugouSession();
    await refreshFromDb();
    setBusy(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal kg-login" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>酷狗登录</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {loggedIn ? (
            <div className="kg-login-status">
              <div className="kg-login-badge">已登录</div>
              <div className="kg-login-detail">
                <span>userid: {userid}</span>
                {refreshedAt > 0 && (
                  <span className="kg-login-refresh">
                    token 刷新于 {new Date(refreshedAt * 1000).toLocaleString()}
                  </span>
                )}
              </div>
              <button className="kg-login-logout" onClick={onLogout} disabled={busy}>
                登出
              </button>
            </div>
          ) : (
            <>
              {qr.kind === 'idle' && (
                <div className="kg-login-prompt">
                  <p>使用酷狗音乐 App 扫码登录后，可自动将点歌加入酷狗歌单</p>
                  <button onClick={startQrLogin}>扫码登录</button>
                </div>
              )}
              {qr.kind === 'loading' && <div className="kg-status">生成二维码中…</div>}
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
                    用 <b>酷狗音乐 App</b>（不是概念版/微信小程序）扫码
                  </div>
                  <button onClick={cancelQr} className="kg-qr-cancel">取消</button>
                </div>
              )}
              {qr.kind === 'error' && (
                <div className="kg-login-error">
                  <div className="kg-status error">{qr.msg}</div>
                  <button onClick={() => setQr({ kind: 'idle' })}>重试</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
