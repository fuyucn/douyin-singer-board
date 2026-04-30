// Theme management.
// Three states: 'system' (follow OS), 'light' (force), 'dark' (force).
// Applied via the data-theme attribute on <html>; CSS picks up via selector.
// Persists user choice to localStorage so it survives restarts.

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'sususongboard.theme';

const LIGHT = '#ffffff';
const DARK = '#1a1a1a';

function resolveOsTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateTitleBar(t: Theme) {
  const html = document.documentElement;
  const isDark = t === 'dark' || (t === 'system' && resolveOsTheme() === 'dark');
  html.style.background = isDark ? DARK : LIGHT;
  html.style.colorScheme = t === 'system' ? 'light dark' : isDark ? 'dark' : 'light';

  // meta theme-color (helps macOS)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark ? DARK : LIGHT);
}

export function loadTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(KEY) as Theme | null;
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function applyTheme(t: Theme): void {
  const html = document.documentElement;
  if (t === 'system') html.removeAttribute('data-theme');
  else html.setAttribute('data-theme', t);
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
