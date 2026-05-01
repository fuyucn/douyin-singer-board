// Theme management.
// Three states: 'system' (follow OS), 'light' (force), 'dark' (force).
// Applied via the data-theme attribute on <html>; CSS picks up via selector.
// Persists user choice to localStorage so it survives restarts.

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'sususongboard.theme';

export function loadTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(KEY) as Theme | null;
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

export function saveTheme(t: Theme): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, t);
  applyTheme(t);
}

export function nextTheme(t: Theme): Theme {
  // cycle order: system → light → dark → system
  if (t === 'system') return 'light';
  if (t === 'light') return 'dark';
  return 'system';
}

export function themeLabel(t: Theme): string {
  if (t === 'light') return 'Light';
  if (t === 'dark') return 'Dark';
  return 'Auto';
}
