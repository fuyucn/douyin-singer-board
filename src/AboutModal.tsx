import { Cross2Icon } from '@radix-ui/react-icons';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CURRENT_VERSION,
  openInBrowser,
  checkForUpdate,
  clearSkippedVersion,
  getSkippedVersion,
} from './updater';
import { Button } from './components/ui/button';

interface Props {
  onClose: () => void;
}

export function AboutModal({ onClose }: Props) {
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
        toast.success(`新版本 ${info.tag} 可用`);
        await openInBrowser(info.htmlUrl);
        onClose();
      } else {
        toast.success('已是最新版本');
      }
    } catch (e) {
      toast.error(`检查失败: ${e}`);
    } finally {
      setChecking(false);
    }
  };

  const onResetSkip = () => {
    clearSkippedVersion();
    setSkipped(null);
    toast('已重置跳过记录');
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
        <div className="border-border-soft flex items-center justify-between border-b px-5 py-2">
          <h2 className="text-fg-base m-0 text-base font-semibold">关于 SUSUSongBoard</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <Cross2Icon className="size-4" />
          </Button>
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
                <Button
                  variant="link"
                  className="text-accent hover:text-accent-hover h-auto p-0 text-[inherit] underline"
                  onClick={onResetSkip}
                >
                  (重置)
                </Button>
              </span>
            </div>
          )}
          <div className="mt-4 flex gap-2.5">
            <Button
              className="bg-success hover:bg-success-hover text-white"
              onClick={onCheck}
              disabled={checking}
            >
              {checking ? '检查中…' : '检查更新'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
