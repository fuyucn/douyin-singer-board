import { useEffect, useRef, useState } from 'react';
import { loadKugouSession, clearKugouSession } from './db';
import { call, ensureDeviceRegistered, saveLogin } from './kugouSession';
import { useAppStore } from './store';
import { Button } from './components/ui/button';
import { Label } from './components/ui/label';
import { Cross2Icon } from '@radix-ui/react-icons';

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
  const preferCumulative = useAppStore((s) => s.preferCumulative);
  const setPreferCumulative = useAppStore((s) => s.setPreferCumulative);

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
      setQr({ kind: 'waiting', key, image, qrUrl, statusLabel: '等待手机扫码', pollCount: 0 });

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
            try {
              await ensureDeviceRegistered();
            } catch {}
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
                  statusLabel: labels[code] ?? `状态: ${code}`,
                  pollCount: prev.pollCount + 1,
                }
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
    <div
      className="bg-overlay animate-fade-in fixed inset-0 z-800 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-elev animate-scale-in w-[380px] max-w-[90vw] overflow-hidden rounded-[10px]"
        style={{ boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-border-soft flex items-center justify-between border-b px-5 py-2">
          <h2 className="text-fg-base m-0 text-base font-semibold">酷狗登录</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <Cross2Icon className="size-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 p-5">
          {loggedIn ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="text-success text-lg font-semibold">已登录</div>
              <div className="text-fg-muted flex flex-col gap-1 text-xs">
                <span>userid: {userid}</span>
                {refreshedAt > 0 && (
                  <span className="text-fg-faint">
                    token 刷新于 {new Date(refreshedAt * 1000).toLocaleString()}
                  </span>
                )}
              </div>

              {/* 累计播放优先 toggle */}
              <Label className="text-fg-muted w-full cursor-pointer px-1">
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={preferCumulative}
                  onChange={(e) => setPreferCumulative(e.target.checked)}
                />
                <span>累计播放优先（搜索时优先匹配历史播放版本）</span>
              </Label>

              <Button
                variant="destructive"
                className="border-danger"
                onClick={onLogout}
                disabled={busy}
              >
                登出
              </Button>
            </div>
          ) : (
            <>
              {qr.kind === 'idle' && (
                <div className="flex flex-col items-center gap-4 text-center">
                  <p className="text-fg-muted m-0 max-w-[280px] text-sm">
                    使用酷狗音乐 App 扫码登录后，可自动将点歌加入酷狗歌单
                  </p>
                  <Button
                    variant={'default'}
                    className={'hover:bg-blue-600'}
                    onClick={startQrLogin}
                  >
                    扫码登录
                  </Button>
                </div>
              )}
              {qr.kind === 'loading' && (
                <div className="text-fg-muted text-center text-sm">生成二维码中…</div>
              )}
              {qr.kind === 'waiting' && (
                <div className="border-border-soft bg-bg-base flex flex-col items-center gap-2 rounded border p-2">
                  <img
                    src={qr.image}
                    alt="KuGou QR"
                    className="h-[220px] w-[220px]"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  <div className="text-fg-muted text-sm">
                    {qr.statusLabel}（已轮询 {qr.pollCount} 次）
                  </div>
                  {qr.qrUrl && (
                    <div className="text-fg-muted flex max-w-full items-center gap-2 text-xs">
                      <code className="bg-bg-soft min-w-0 flex-1 overflow-hidden rounded px-2 py-1 font-mono text-ellipsis whitespace-nowrap">
                        {qr.qrUrl}
                      </code>
                      <Button
                        variant="link"
                        size="xs"
                        className="text-accent h-auto p-0"
                        onClick={() => navigator.clipboard.writeText(qr.qrUrl)}
                      >
                        复制
                      </Button>
                    </div>
                  )}
                  <div className="text-fg-muted max-w-[320px] text-center text-xs">
                    用 <b>酷狗音乐 App</b>（不是概念版/微信小程序）扫码
                  </div>
                  <Button variant="outline" size="sm" className="mt-2" onClick={cancelQr}>
                    取消
                  </Button>
                </div>
              )}
              {qr.kind === 'error' && (
                <div className="flex flex-col items-center gap-3">
                  <div className="text-danger-soft-fg text-sm">{qr.msg}</div>
                  <Button variant="outline" size="sm" onClick={() => setQr({ kind: 'idle' })}>
                    重试
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
