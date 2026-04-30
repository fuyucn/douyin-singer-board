// Theme management.
// Three states: 'system' (follow OS), 'light' (force), 'dark' (force).
// Applied via the data-theme attribute on <html>; CSS picks up via selector.
// Persists user choice to localStorage so it survives restarts.

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'sususongboard.theme';

function resolveOsTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function updateMetaTheme(t: Theme) {
  // macOS: meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    if (t === 'dark') meta.setAttribute('content', '#1a1a1a');
    else if (t === 'light') meta.setAttribute('content', '#ffffff');
    else meta.setAttribute('content', resolveOsTheme() === 'dark' ? '#1a1a1a' : '#ffffff');
  }

  // Windows: Tauri window theme
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    if (t === 'dark') {
      getCurrentWindow().setTheme('dark');
    } else if (t === 'light') {
      getCurrentWindow().setTheme('light');
    } else {
      getCurrentWindow().setTheme(null);
    }
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
  updateMetaTheme(t);
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

export function themeIcon(t: Theme): string {
  if (t === 'light') return '☀';
  if (t === 'dark') return '☾';
  return '◐'; // system / auto
}

export function themeLabel(t: Theme): string {
  if (t === 'light') return 'Light';
  if (t === 'dark') return 'Dark';
  return 'Auto';
}

// Listen to OS theme changes when in system mode
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = loadTheme();
    if (current === 'system') updateMetaTheme('system');
  });
}
