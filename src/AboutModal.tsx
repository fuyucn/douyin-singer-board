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
    <div
      className="bg-overlay animate-fade-in fixed inset-0 z-[800] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-elev animate-scale-in w-[380px] max-w-[90vw] overflow-hidden rounded-[10px]"
        style={{ boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-border-soft flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-fg-base m-0 text-base font-semibold">关于 SUSUSongBoard</h2>
          <button
            className="text-fg-muted hover:text-fg-base cursor-pointer border-none bg-transparent px-1 py-0 text-xl leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {/* Body */}
        <div className="p-5">
          <div className="mb-3.5 flex items-center gap-3 text-sm">
            <span className="text-fg-muted min-w-[60px]">版本</span>
            <span className="text-fg-base">v{CURRENT_VERSION}</span>
          </div>
          {skipped && (
            <div className="mb-3.5 flex items-center gap-3 text-sm">
              <span className="text-fg-muted min-w-[60px]">已跳过</span>
              <span className="text-fg-base">
                {skipped}{' '}
                <button
                  className="text-accent hover:text-accent-hover inline cursor-pointer border-none bg-transparent p-0 text-[inherit] underline"
                  onClick={onResetSkip}
                >
                  (重置)
                </button>
              </span>
            </div>
          )}
          <div className="mt-4 flex gap-2.5">
            <button
              className="bg-success hover:bg-success-hover cursor-pointer rounded border-none px-6 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
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
