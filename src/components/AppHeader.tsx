import { Moon, Sun, Play, Square } from 'lucide-react';
import { GearIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { Button } from '@/components/ui/button';
import { AppLogo } from './AppLogo';
import { ConnectionStatus } from './ConnectionStatus';
import type { Theme } from '../theme';

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

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-elev)] px-4">
      {/* Logo + title */}
      <AppLogo />
      <span className="font-semibold text-[var(--fg-base)]">SUSUSongBoard</span>
      <ConnectionStatus />

      <div className="flex-1" />

      {/* Right actions */}
      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-[var(--fg-muted)] hover:text-[var(--fg-base)]"
          onClick={() => onThemeChange(isDark ? 'light' : 'dark')}
          title={isDark ? '切换亮色' : '切换暗色'}
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        {/* Kugou login */}
        {kugouEnabled && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
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
            className="size-8 text-[var(--fg-muted)] hover:text-[var(--fg-base)]"
            onClick={onShowKgDebug}
            title="KuGou API 调试面板"
          >
            <GearIcon className="size-4" />
          </Button>
        )}

        {/* About */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-[var(--fg-muted)] hover:text-[var(--fg-base)]"
          onClick={onShowAbout}
          title="关于 / 检查更新"
        >
          <InfoCircledIcon className="size-4" />
        </Button>

        {/* Start / Stop — primary action */}
        {!running ? (
          <Button
            size="icon"
            className="ml-2 size-8"
            onClick={onStart}
            title="开始"
          >
            <Play className="size-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant="destructive"
            className="ml-2 size-8"
            onClick={onStop}
            title="停止"
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        )}
      </div>
    </header>
  );
}
