// esbuild wrapper for the sidecar bundle.
//
// kugou-slim/server.cjs imports modules from the kugou-api submodule, and those
// modules use bare dependencies (express, axios, qrcode, ...) that live in
// kugou-api/node_modules. Resolve from that store explicitly; walking up to the
// root node_modules can pull a different major version (e.g. Express 5) into
// the sidecar bundle and change request behavior. The wrapper installs the
// dependencies on first use so this works in a fresh checkout and in CI.
//
// Usage:
//   node scripts/bundle.mjs            (one-shot build)
//   node scripts/bundle.mjs --watch    (dev watch)

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = resolve(__dirname, '..');
const root = resolve(sidecarDir, '..');
const kugouDir = join(root, 'kugou-api');

if (!existsSync(join(kugouDir, 'package.json'))) {
  console.error(
    `kugou-api submodule not found at ${kugouDir}. Run "git submodule update --init --recursive".`,
  );
  process.exit(1);
}

if (!existsSync(join(kugouDir, 'node_modules', 'express'))) {
  console.log('[deps] pnpm install in kugou-api');
  execSync('pnpm install --frozen-lockfile --ignore-workspace', {
    cwd: kugouDir,
    stdio: 'inherit',
  });
}

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: [join(sidecarDir, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(sidecarDir, 'build/index.cjs'),
  nodePaths: [join(kugouDir, 'node_modules')],
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
