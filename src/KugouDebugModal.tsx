// Developer panel for exercising the embedded KuGouMusicApi server. The four
// buttons cover the workflow we need to validate (login → list playlists →
// search → add) before investing in a real QR-login UX.

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveCookie = () => {
    try {
      localStorage.setItem(COOKIE_KEY, cookie);
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal kg-debug" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>KuGou API 调试面板</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <label className="kg-row">
            <span className="label">Cookie</span>
            <textarea
              className="kg-cookie"
              rows={3}
              placeholder="从 www.kugou.com 登录后 DevTools → Application → Cookies 复制全部，或粘贴 token=xxx;userid=yyy;...格式"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              onBlur={saveCookie}
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
