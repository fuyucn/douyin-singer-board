// Dev orchestrator: runs sidecar esbuild --watch in parallel with `tauri dev`.
// SIDECAR_DEV_PATH env tells the Rust side to spawn `node <path>` instead of
// extracting the embedded binary, so changes to sidecar/src/*.ts hot-reload.

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

const procs = [];

function start(name, cmd, args) {
  const p = spawn(cmd, args, { stdio: 'inherit', env, cwd: root });
  procs.push({ name, p });
  p.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    cleanup(code ?? 0);
  });
  return p;
}

function cleanup(code) {
  for (const { name, p } of procs) {
    if (!p.killed) {
      console.log(`[dev] killing ${name}`);
      try {
        p.kill('SIGTERM');
      } catch {}
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

start('sidecar:dev:watch', 'pnpm', ['--filter', 'sidecar', 'dev:watch']);
start('tauri', 'pnpm', ['exec', 'tauri', 'dev']);
