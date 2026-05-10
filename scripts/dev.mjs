// Dev orchestrator: runs sidecar esbuild --watch in parallel with `tauri dev`.
// SIDECAR_DEV_PATH env tells the Rust side to spawn `node <path>` instead of
// extracting the embedded binary, so changes to sidecar/src/*.ts hot-reload.
//
// Cleanup: child is spawned as a process group leader (detached on Unix) so
// we can SIGKILL the whole tree via negative PGID. Without this, pnpm's
// SIGTERM doesn't propagate to its grandchildren (cargo, tauri, sidecar).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sidecarBuild = path.join(root, 'sidecar', 'build', 'index.cjs');

const env = {
  ...process.env,
  SIDECAR_DEV_PATH: sidecarBuild,
};

const isWindows = process.platform === 'win32';
const procs = [];

function start(name, cmd, args) {
  const p = spawn(cmd, args, {
    stdio: 'inherit',
    env,
    cwd: root,
    detached: !isWindows, // process group leader on Unix; ignored on Windows
  });
  procs.push({ name, p });
  p.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    cleanup(code ?? 0);
  });
  return p;
}

function cleanup(code) {
  for (const { name, p } of procs) {
    if (p.killed || p.exitCode !== null) continue;
    console.log(`[dev] killing ${name} (pid ${p.pid})`);
    try {
      if (isWindows) {
        // Windows: taskkill the entire tree
        spawn('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore' });
      } else {
        // Unix: SIGKILL the whole process group
        process.kill(-p.pid, 'SIGKILL');
      }
    } catch {
      try {
        p.kill('SIGKILL');
      } catch {}
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
process.on('exit', () => {
  // Synchronous best-effort cleanup if we exit unexpectedly
  for (const { p } of procs) {
    if (p.killed || p.exitCode !== null) continue;
    try {
      if (!isWindows) process.kill(-p.pid, 'SIGKILL');
    } catch {}
  }
});

start('sidecar:dev:watch', 'pnpm', ['--filter', 'sidecar', 'dev:watch']);
start('tauri', 'pnpm', ['exec', 'tauri', 'dev']);
