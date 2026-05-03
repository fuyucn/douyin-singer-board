import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Disable in-app refresh: Cmd+R / Ctrl+R / F5 always; right-click context menu
// (which contains "Reload" on Linux/Windows WebViews) only in production builds
// so dev tools / right-click → Inspect still work locally.
window.addEventListener('keydown', (e) => {
  const isReloadCombo =
    ((e.key === 'r' || e.key === 'R') && (e.metaKey || e.ctrlKey)) || e.key === 'F5';
  if (isReloadCombo) {
    e.preventDefault();
    e.stopPropagation();
  }
});
if (import.meta.env.PROD) {
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Show window only after React has rendered, avoiding the black-screen flash.
getCurrentWindow().show();
