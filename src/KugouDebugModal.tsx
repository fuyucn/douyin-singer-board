// Developer panel for exercising the embedded KuGouMusicApi server.

import { useEffect, useRef, useState } from 'react';
import { loadKugouSession, saveKugouSession, clearKugouSession, sessionToCookie } from './db';
import { ensureDeviceRegistered, refreshToken, saveLogin, call } from './kugouSession';
import { useAppStore } from './store';
import { useShallow } from 'zustand/react/shallow';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

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
  const { pushLog, preferCumulative, setPreferCumulative } = useAppStore(
    useShallow((s) => ({
      pushLog: s.pushLog,
      preferCumulative: s.preferCumulative,
      setPreferCumulative: s.setPreferCumulative,
    })),
  );

  const [cookie, setCookie] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [keyword, setKeyword] = useState('海阔天空');
  const [listid, setListid] = useState('');
  const [songData, setSongData] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; data: ApiResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<QrState>({ kind: 'idle' });
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    loadKugouSession()
      .then((s) => {
        setCookie(sessionToCookie(s));
        setRefreshedAt(s.refreshed_at);
      })
      .catch((e) => setError(`load session: ${e}`));
  }, []);

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
      await saveKugouSession({ dfid: '' });
      const dfid = await ensureDeviceRegistered();
      await refreshFromDb();
      setResult({ label: 'register/dev', data: { status: dfid ? 200 : 0, body: { dfid } } });
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
      setResult({ label: 'login/token (refreshed)', data: { status: 200, body: { token: newToken } } });
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
  const onListPlaylists = () => run('GET /user/playlist', () => call('GET', '/user/playlist?pagesize=100', cookie));
  const onUserListen = () => run('GET /user/listen?type=1', () => call('GET', '/user/listen?type=1', cookie));
  const onUserHistory = () => run('GET /user/history', () => call('GET', '/user/history', cookie));
  const onSearch = () => run('GET /search', () => call('GET', `/search?keywords=${encodeURIComponent(keyword)}&pagesize=5`, cookie));

  const onAddTrack = () => {
    if (!listid.trim()) { setError('listid required'); return; }
    if (!songData.trim()) { setError('songData required (name|hash|album_id|mixsongid)'); return; }
    return run('GET /playlist/tracks/add', () =>
      call('GET', `/playlist/tracks/add?listid=${encodeURIComponent(listid)}&data=${encodeURIComponent(songData)}`, cookie),
    );
  };

  const stopPoll = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

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
      const createResp = await call('GET', `/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true`, '');
      const image = String(createResp.body?.data?.base64 ?? '');
      const qrUrl = String(createResp.body?.data?.url ?? '');
      if (!image) {
        setQr({ kind: 'error', msg: '/login/qr/create 没返回 base64 图片' });
        return;
      }
      setQr({ kind: 'waiting', key, image, qrUrl, statusLabel: '等待手机扫码', pollCount: 0, lastResp: null });

      pollRef.current = window.setInterval(async () => {
        try {
          const r = await call('GET', `/login/qr/check?key=${encodeURIComponent(key)}`, '');
          setResult({ label: `/login/qr/check`, data: r });
          const data = r.body?.data ?? {};
          const rawStatus = data.status;
          const code = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus ?? -1);

          if (code === 4) {
            stopPoll();
            const token = String(data.token ?? r.body?.token ?? '');
            const userid = String(data.userid ?? r.body?.userid ?? '');
            if (!token || !userid) {
              setQr({ kind: 'error', msg: 'status=4 but no token/userid (see 结果 panel below)' });
              return;
            }
            await saveLogin(token, userid);
            try {
              const dfid = await ensureDeviceRegistered();
              setResult({ label: 'login complete (dfid acquired)', data: { status: 200, body: { dfid } } });
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
          const labels: Record<number, string> = { 1: '等待手机扫码', 2: '已扫码，等待手机确认' };
          setQr((prev) =>
            prev.kind === 'waiting'
              ? { ...prev, statusLabel: labels[code] ?? `status=${code}`, pollCount: prev.pollCount + 1, lastResp: r }
              : prev,
          );
        } catch (e) {
          setError(`qr check err: ${e}`);
          setQr((prev) => prev.kind === 'waiting' ? { ...prev, pollCount: prev.pollCount + 1 } : prev);
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

  const copyResult = () => {
    if (!result) return;
    const json = JSON.stringify(result.data.body, null, 2);
    navigator.clipboard
      .writeText(json)
      .then(() => pushLog(`[kg-dev] copied ${json.length} chars`))
      .catch((err) => pushLog(`[kg-dev] copy failed: ${err}`));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(90vw,680px)] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>KuGou API 调试面板</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* QR Login */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={startQrLogin}
              disabled={qr.kind === 'loading' || qr.kind === 'waiting'}
            >
              {qr.kind === 'loading' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              扫码登录 (KuGou 手机 App)
            </Button>
            {(qr.kind === 'waiting' || qr.kind === 'error') && (
              <Button variant="ghost" onClick={cancelQr}>取消</Button>
            )}
          </div>

          {qr.kind === 'waiting' && (
            <div className="flex flex-col items-center gap-2 p-4 border rounded-lg">
              <img src={qr.image} alt="KuGou QR" className="w-40 h-40" />
              <Badge variant="secondary">{qr.statusLabel}（已轮询 {qr.pollCount} 次）</Badge>
              {qr.qrUrl && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <code className="truncate max-w-xs">{qr.qrUrl}</code>
                  <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(qr.qrUrl as string)}>
                    复制
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground text-center">
                用 <b>酷狗音乐 App</b>（不是概念版）扫码
              </p>
            </div>
          )}
          {qr.kind === 'error' && (
            <p className="text-sm text-destructive">QR: {qr.msg}</p>
          )}

          {/* Cookie */}
          <div className="space-y-1.5">
            <Label>Cookie</Label>
            <Textarea
              rows={3}
              placeholder="扫码登录后自动持久化到 SQLite。手动编辑可改 token / userid / dfid"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              onBlur={async () => {
                const parsed: Record<string, string> = {};
                cookie.split(';').forEach((p) => {
                  const idx = p.indexOf('=');
                  if (idx > 0) parsed[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
                });
                await saveKugouSession({ token: parsed.token ?? '', userid: parsed.userid ?? '', dfid: parsed.dfid ?? '' });
              }}
            />
            <p className="text-xs text-muted-foreground">
              {refreshedAt > 0
                ? `登录态已持久化 — token 上次刷新: ${new Date(refreshedAt * 1000).toLocaleString()}`
                : '未登录'}
            </p>
          </div>

          {/* Session actions */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={onRefreshToken} disabled={!cookie || busy !== null}>
              {busy === 'login/token' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              刷新 Token
            </Button>
            <Button size="sm" variant="outline" onClick={onRegisterDev} disabled={!cookie || busy !== null}>
              {busy === 'register/dev' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              重新注册设备
            </Button>
            <Button size="sm" variant="ghost" onClick={onLogout} disabled={!cookie || busy !== null}>
              清空 session
            </Button>
          </div>

          {/* API actions */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={onUserDetail} disabled={!cookie || busy !== null}>测试登录</Button>
            <Button size="sm" variant="outline" onClick={onListPlaylists} disabled={!cookie || busy !== null}>列我的歌单</Button>
            <Button size="sm" variant="outline" onClick={onUserListen} disabled={!cookie || busy !== null}>累计播放榜</Button>
            <Button size="sm" variant="outline" onClick={onUserHistory} disabled={!cookie || busy !== null}>最近播放流水</Button>
          </div>

          {/* Prefer cumulative */}
          <div className="flex items-start gap-2">
            <Switch
              id="prefer-cumulative"
              checked={preferCumulative}
              onCheckedChange={(checked) => {
                setPreferCumulative(checked);
                pushLog(`[kg-dev] 累计播放优先 = ${checked ? 'on' : 'off'}`);
              }}
              className="mt-0.5 shrink-0"
            />
            <Label htmlFor="prefer-cumulative" className="text-sm cursor-pointer leading-snug">
              累计播放优先（用 /user/listen 历史挑版本，关闭则取搜索首条）
            </Label>
          </div>

          {/* Search */}
          <div className="flex gap-2 items-center">
            <Label className="shrink-0">关键词</Label>
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            <Button size="sm" onClick={onSearch} disabled={!cookie || busy !== null}>搜索</Button>
          </div>

          {/* Add track */}
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <Label className="shrink-0 w-12">listid</Label>
              <Input value={listid} onChange={(e) => setListid(e.target.value)} placeholder="从「列我的歌单」结果里挑一个 listid" />
            </div>
            <div className="flex gap-2 items-center">
              <Label className="shrink-0 w-12">data</Label>
              <Input value={songData} onChange={(e) => setSongData(e.target.value)} placeholder="name|hash|album_id|mixsongid" />
              <Button size="sm" onClick={onAddTrack} disabled={!cookie || busy !== null}>加入歌单</Button>
            </div>
          </div>

          {/* Status */}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {busy}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Result */}
          {result && (
            <details className="border rounded-lg" open>
              <summary className="flex items-center justify-between px-3 py-2 cursor-pointer text-sm font-medium select-none">
                <span>{result.label} → status {result.data.status}</span>
                <Button size="sm" variant="ghost" onClick={(e) => { e.preventDefault(); copyResult(); }}>
                  复制
                </Button>
              </summary>
              <pre className="p-3 text-xs overflow-auto max-h-60 bg-muted/50 rounded-b-lg">
                {JSON.stringify(result.data.body, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
