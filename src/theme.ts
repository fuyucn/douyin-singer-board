// Theme management.
// Three states: 'system' (follow OS), 'light' (force), 'dark' (force).
// Applied via the data-theme attribute on <html>; CSS picks up via selector.
// Persists user choice to localStorage so it survives restarts.

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'sususongboard.theme';

function resolveOsTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function updateTitleBar(t: Theme) {
  // meta theme-color (helps macOS)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const color =
      t === 'dark'
        ? '#1a1a1a'
        : t === 'light'
          ? '#ffffff'
          : resolveOsTheme() === 'dark'
            ? '#1a1a1a'
            : '#ffffff';
    meta.setAttribute('content', color);
  }

  // Tauri invoke: plugin:window|set_theme (Windows + macOS)
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const theme = t === 'dark' ? 'dark' : t === 'light' ? 'light' : null;
    await invoke('plugin:window|set_theme', { theme });
  } catch {
    // not in Tauri (e.g. browser dev) — ignore
  }
}

export function loadTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(KEY) as Theme | null;
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  updateTitleBar(t);
}

export function saveTheme(t: Theme): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, t);
  applyTheme(t);
}

export function nextTheme(t: Theme): Theme {
  if (t === 'system') return 'light';
  if (t === 'light') return 'dark';
  return 'system';
}

export function themeIcon(t: Theme): string {
  if (t === 'light') return '☀';
  if (t === 'dark') return '☾';
  return '◐';
}

export function themeLabel(t: Theme): string {
  if (t === 'light') return 'Light';
  if (t === 'dark') return 'Dark';
  return 'Auto';
}

// Listen to OS theme changes when in system mode
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (loadTheme() === 'system') updateTitleBar('system');
  });
}
