import { Bug, Info, Moon, Play, Square, Sun, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppLogo } from './AppLogo';
import { ConnectionStatus } from './ConnectionStatus';
import type { Theme } from '../theme';
import { useShowLogs } from '../hooks/useShowLogs';

interface Props {
  theme: Theme;
  running: boolean;
  kugouEnabled: boolean;
  kugouLoggedIn: boolean;
  onThemeChange: (t: Theme) => void;
  onShowKgLogin: () => void;
  onShowAbout: () => void;
  onShowKgDebug?: () => void;
  onStart: () => void;
  onStop: () => void;
}

export function AppHeader({
  theme,
  running,
  kugouEnabled,
  kugouLoggedIn,
  onThemeChange,
  onShowKgLogin,
  onShowAbout,
  onShowKgDebug,
  onStart,
  onStop,
}: Props) {
  const isDark = theme === 'dark';
  const [showLogs, setShowLogs] = useShowLogs();

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-elev)] px-4">
      {/* Logo + title */}
      <AppLogo />
      <div className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="text-sm font-semibold text-[var(--fg-base)]">SUSUSongBoard</span>
      </div>
      <ConnectionStatus />

      <div className="flex-1" />

      {/* Right actions */}
      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-[30px] rounded-[6px] text-[var(--fg-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--fg-base)]"
          onClick={() => onThemeChange(isDark ? 'light' : 'dark')}
          title={isDark ? '切换亮色' : '切换暗色'}
        >
          {isDark ? <Sun className="size-[15px]" /> : <Moon className="size-[15px]" />}
        </Button>

        {/* Kugou login */}
        {kugouEnabled && (
          <Button
            variant="ghost"
            size="icon"
            className="size-[30px] rounded-[6px]"
            onClick={onShowKgLogin}
            title={kugouLoggedIn ? '酷狗已登录' : '酷狗未登录'}
          >
            <img
              src="/kugou.svg"
              className={`block size-4 rounded-full object-contain ${kugouLoggedIn ? '' : 'opacity-80 grayscale'}`}
              alt="KuGou"
              draggable={false}
            />
          </Button>
        )}

        {/* Settings / debug */}
        {kugouEnabled && onShowKgDebug && (
          <Button
            variant="ghost"
            size="icon"
            className="size-[30px] rounded-[6px] text-[var(--fg-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--fg-base)]"
            onClick={onShowKgDebug}
            title="KuGou API 调试面板"
          >
            <Bug className="size-[15px]" />
          </Button>
        )}

        {/* Logs */}
        <Button
          variant="ghost"
          size="icon"
          className="size-[30px] rounded-[6px] text-[var(--fg-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--fg-base)]"
          onClick={() => setShowLogs(!showLogs)}
          title="日志"
        >
          <Terminal className="size-[15px]" />
        </Button>

        {/* About */}
        <Button
          variant="ghost"
          size="icon"
          className="size-[30px] rounded-[6px] text-[var(--fg-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--fg-base)]"
          onClick={onShowAbout}
          title="关于 / 检查更新"
        >
          <Info className="size-[15px]" />
        </Button>

        {/* Start / Stop — primary action */}
        {!running ? (
          <Button
            size="icon"
            className="ml-2 size-8 rounded-[6px] bg-[var(--fg-base)] text-[var(--bg-base)] hover:bg-[var(--fg-muted)]"
            onClick={onStart}
            title="开始"
          >
            <Play className="size-[15px]" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant="outline"
            className="ml-2 size-8 rounded-[6px] border-transparent bg-[var(--danger)] text-white hover:bg-[var(--danger-hover)]"
            onClick={onStop}
            title="停止"
          >
            <Square className="size-[15px] fill-current" />
          </Button>
        )}
      </div>
    </header>
  );
}
