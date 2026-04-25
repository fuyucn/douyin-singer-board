import { useEffect, useState } from 'react';
import {
  CURRENT_VERSION,
  REPO_URL,
  RELEASES_URL,
  ISSUES_URL,
  openInBrowser,
  checkForUpdate,
  clearSkippedVersion,
  getSkippedVersion,
} from './updater';

interface Props {
  onClose: () => void;
  onShowToast: (msg: string, kind?: 'success' | 'error') => void;
}

export function AboutModal({ onClose, onShowToast }: Props) {
  const [skipped, setSkipped] = useState<string | null>(getSkippedVersion());
  const [checking, setChecking] = useState(false);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onCheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const info = await checkForUpdate();
      if (info) {
        onShowToast(`新版本 ${info.tag} 可用`, 'success');
        await openInBrowser(info.htmlUrl);
        onClose();
      } else {
        onShowToast('已是最新版本', 'success');
      }
    } catch (e) {
      onShowToast(`检查失败: ${e}`, 'error');
    } finally {
      setChecking(false);
    }
  };

  const onResetSkip = () => {
    clearSkippedVersion();
    setSkipped(null);
    onShowToast('已重置跳过记录');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>关于 SUSUSongBoard</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="row">
            <span className="label">版本</span>
            <span className="value">v{CURRENT_VERSION}</span>
          </div>
          <div className="row">
            <span className="label">仓库</span>
            <button className="link" onClick={() => openInBrowser(REPO_URL)}>
              {REPO_URL.replace('https://', '')}
            </button>
          </div>
          <div className="row">
            <span className="label">所有版本</span>
            <button className="link" onClick={() => openInBrowser(RELEASES_URL)}>
              GitHub Releases
            </button>
          </div>
          <div className="row">
            <span className="label">反馈 / Bug</span>
            <button className="link" onClick={() => openInBrowser(ISSUES_URL)}>
              提交 Issue
            </button>
          </div>
          {skipped && (
            <div className="row">
              <span className="label">已跳过</span>
              <span className="value">
                {skipped}{' '}
                <button className="link inline" onClick={onResetSkip}>(重置)</button>
              </span>
            </div>
          )}
          <div className="actions">
            <button className="primary" onClick={onCheck} disabled={checking}>
              {checking ? '检查中…' : '检查更新'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
