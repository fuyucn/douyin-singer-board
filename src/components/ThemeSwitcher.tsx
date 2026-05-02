import { Half2Icon, MoonIcon, SunIcon } from '@radix-ui/react-icons';
import { nextTheme, saveTheme, themeLabel, type Theme } from '../theme';
import { HeaderButton } from './HeaderButton';

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') return <SunIcon className="size-4" />;
  if (theme === 'dark') return <MoonIcon className="size-4" />;
  return <Half2Icon className="size-4" />;
}

interface Props {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}

export function ThemeSwitcher({ theme, onThemeChange }: Props) {
  return (
    <HeaderButton
      onClick={() => {
        const t = nextTheme(theme);
        saveTheme(t);
        onThemeChange(t);
      }}
      title={`主题: ${themeLabel(theme)}`}
    >
      <ThemeIcon theme={theme} />
    </HeaderButton>
  );
}
