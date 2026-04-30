import { useEffect, useState } from 'react';
import {
  CURRENT_VERSION,
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
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft">
          <h2 className="m-0 text-base font-semibold text-fg-base">关于 SUSUSongBoard</h2>
          <button
            className="bg-transparent border-none text-xl leading-none cursor-pointer text-fg-muted hover:text-fg-base px-1 py-0"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {/* Body */}
        <div className="p-5">
          <div className="flex gap-3 mb-3.5 items-center text-sm">
            <span className="text-fg-muted min-w-[60px]">版本</span>
            <span className="text-fg-base">v{CURRENT_VERSION}</span>
          </div>
          {skipped && (
            <div className="flex gap-3 mb-3.5 items-center text-sm">
              <span className="text-fg-muted min-w-[60px]">已跳过</span>
              <span className="text-fg-base">
                {skipped}{' '}
                <button
                  className="bg-transparent border-none text-accent hover:text-accent-hover cursor-pointer p-0 text-[inherit] underline inline"
                  onClick={onResetSkip}
                >
                  (重置)
                </button>
              </span>
            </div>
          )}
          <div className="mt-4 flex gap-2.5">
            <button
              className="px-6 py-2 bg-success hover:bg-success-hover text-white border-none rounded cursor-pointer font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onCheck}
              disabled={checking}
            >
              {checking ? '检查中…' : '检查更新'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
