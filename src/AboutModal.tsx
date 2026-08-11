import { Cross2Icon } from '@radix-ui/react-icons';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import {
  CURRENT_VERSION,
  openInBrowser,
  checkForUpdate,
  clearSkippedVersion,
  getSkippedVersion,
  updaterEnabled,
} from './updater';
import { Button } from './components/ui/button';
import {
  isTelemetryOptedIn,
  setTelemetryOptIn,
  exportTelemetry,
  clearTelemetry,
} from './telemetry';
import { Switch } from './components/ui/switch';
import { useShowLogs } from './hooks/useShowLogs';
import { saveConfig } from './db';
import { useAppStore } from './store';

interface Props {
  onClose: () => void;
  onOpenKgDebug?: () => void;
}

export function AboutModal({ onClose, onOpenKgDebug }: Props) {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const setAutoSync = useAppStore((s) => s.setAutoSync);
  const logs = useAppStore((s) => s.logs);
  const [skipped, setSkipped] = useState<string | null>(getSkippedVersion());
  const [checking, setChecking] = useState(false);
  const [telemetryOn, setTelemetryOn] = useState(false);
  const [showLogs, setShowLogs] = useShowLogs();
  const [kugouBusy, setKugouBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    isTelemetryOptedIn().then(setTelemetryOn);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onToggleTelemetry = async (next: boolean) => {
    await setTelemetryOptIn(next);
    setTelemetryOn(next);
    toast.success(next ? '已启用匿名诊断数据' : '已关闭');
  };

  const onExportTelemetry = async () => {
    try {
      const jsonl = await exportTelemetry(CURRENT_VERSION, logs);
      await navigator.clipboard.writeText(jsonl);
      toast.success(`诊断数据已复制到剪贴板 (${logs.length} 条日志)`);
    } catch (e) {
      toast.error(`导出失败: ${e}`);
    }
  };

  const onClearTelemetry = async () => {
    await clearTelemetry();
    toast.success('诊断数据已清空');
  };

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

  const onToggleKugou = async (next: boolean) => {
    if (kugouBusy) return;
    setKugouBusy(true);
    try {
      await invoke('kugou_set_enabled', { enabled: next });
      setConfig({ kugou_enabled: next });
      if (!next) setAutoSync(false);
      await saveConfig({ ...config, kugou_enabled: next });
      toast.success(next ? '已启用 Kugou 功能' : '已关闭 Kugou 功能');
    } catch (e) {
      toast.error(`Kugou 功能切换失败: ${e}`);
    } finally {
      setKugouBusy(false);
    }
  };

  return (
    <div
      className="bg-overlay animate-fade-in fixed inset-0 z-[800] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-elev animate-scale-in w-[380px] max-w-[90vw] overflow-hidden rounded-[8px]"
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
          {updaterEnabled && skipped && (
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
          {updaterEnabled && (
            <div className="mt-4 flex gap-2.5">
              <Button className="bg-success text-white" onClick={onCheck} disabled={checking}>
                {checking ? '检查中…' : '检查更新'}
              </Button>
            </div>
          )}

          {/* Telemetry section */}
          <div className="border-border-soft mt-5 border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-fg-base text-sm font-medium">匿名诊断数据</div>
                <div className="text-fg-muted text-[11px] leading-snug">
                  本地记录崩溃和事件以便调试，从不上传。
                </div>
              </div>
              <Switch checked={telemetryOn} onCheckedChange={onToggleTelemetry} />
            </div>
            {telemetryOn && (
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={onExportTelemetry}>
                  复制诊断数据
                </Button>
                <Button variant="ghost" size="sm" onClick={onClearTelemetry}>
                  清空
                </Button>
              </div>
            )}
          </div>

          {/* Show logs panel toggle */}
          <div className="border-border-soft mt-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-fg-base text-sm font-medium">显示日志面板</div>
                <div className="text-fg-muted text-[11px] leading-snug">
                  在主界面底部显示日志面板，便于排查问题。
                </div>
              </div>
              <Switch checked={showLogs} onCheckedChange={setShowLogs} />
            </div>
          </div>

          {/* Kugou feature toggle */}
          <div className="border-border-soft mt-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-fg-base text-sm font-medium">Kugou 功能</div>
                <div className="text-fg-muted text-[11px] leading-snug">
                  启用酷狗登录、搜索与歌单同步服务。
                </div>
              </div>
              <Switch
                checked={config.kugou_enabled}
                disabled={kugouBusy}
                onCheckedChange={onToggleKugou}
              />
            </div>
            {config.kugou_enabled && onOpenKgDebug && (
              <Button variant="outline" size="sm" className="mt-2.5" onClick={onOpenKgDebug}>
                打开 KuGou 调试面板
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
