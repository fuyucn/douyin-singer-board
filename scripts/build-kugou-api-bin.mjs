// Compile the KuGouMusicApi submodule into a per-platform native binary.
// Mirrors sidecar/scripts/build-bin.mjs and writes the output next to
// the danmu sidecar as src-tauri/binaries/kugou-api-{rustTriple}{ext},
// so src-tauri/build.rs can pick it up the same way.
//
// pkg config (scripts to bundle, modules to keep) is already declared in
// the upstream kugou-api/package.json, so we don't touch the submodule —
// we only invoke pkg with cwd=kugou-api.
//
// Usage: pnpm kugou-api:build:bin

import { execSync } from 'node:child_process';
import { mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchWindowsSubsystem } from './patch-pe-subsystem.mjs';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const kugouDir = join(root, 'kugou-api');
const binariesDir = join(root, 'src-tauri', 'binaries');

if (!existsSync(join(kugouDir, 'package.json'))) {
  console.error(
    `kugou-api submodule not found at ${kugouDir}. Run "git submodule update --init --recursive".`,
  );
  process.exit(1);
}

function rustTriple() {
  const out = execSync('rustc -vV', { encoding: 'utf8' });
  const m = out.match(/host:\s*(\S+)/);
  if (!m) throw new Error('cannot determine rust host triple');
  return m[1];
}

function pkgTarget(triple) {
  if (triple.includes('apple-darwin')) {
    return triple.startsWith('aarch64') ? 'node20-macos-arm64' : 'node20-macos-x64';
  }
  if (triple.includes('windows')) {
    return triple.startsWith('aarch64') ? 'node20-win-arm64' : 'node20-win-x64';
  }
  if (triple.includes('linux')) {
    return triple.startsWith('aarch64') ? 'node20-linux-arm64' : 'node20-linux-x64';
  }
  throw new Error(`unsupported triple ${triple}`);
}

const triple = rustTriple();
const target = pkgTarget(triple);
const ext = triple.includes('windows') ? '.exe' : '';
const outName = `kugou-api-${triple}${ext}`;
const outPath = join(binariesDir, outName);

mkdirSync(binariesDir, { recursive: true });

// 1) Install KuGouMusicApi's own deps inside the submodule, isolated from our
//    workspace (the submodule has its own pnpm-lock.yaml).
console.log('[deps] pnpm install in kugou-api');
execSync('pnpm install --frozen-lockfile --ignore-workspace', {
  cwd: kugouDir,
  stdio: 'inherit',
});

// 2) pkg compile — pkg picks up scripts/assets config from kugou-api/package.json.
//    We resolve @yao-pkg/pkg from the root devDeps and invoke its bin file
//    explicitly so the older `pkg` listed in upstream devDeps is bypassed.
console.log(`[pkg] target=${target} -> ${outPath}`);
const tmp = join(kugouDir, `__pkg_out${ext}`);
try { rmSync(tmp); } catch {}

const pkgBin = require.resolve('@yao-pkg/pkg/lib-es5/bin.js', { paths: [root] });
execSync(
  `node ${JSON.stringify(pkgBin)} . --target ${target} --output ${JSON.stringify(tmp)} --no-bytecode`,
  { cwd: kugouDir, stdio: 'inherit' },
);

copyFileSync(tmp, outPath);
try { rmSync(tmp); } catch {}

// Patch Windows .exe to use WINDOWS subsystem (no console window on startup).
if (ext === '.exe') patchWindowsSubsystem(outPath);

console.log(`[ok] ${outPath}`);
