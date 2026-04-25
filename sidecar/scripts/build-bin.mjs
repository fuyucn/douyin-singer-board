// Compile the sidecar into a per-platform native binary, named per Tauri's externalBin convention:
//   src-tauri/binaries/sidecar-{rustTriple}{ext}
//
// Host triple is obtained via `rustc -vV`. To produce binaries for other platforms,
// run this on each target platform (e.g. via a CI matrix).
//
// Usage:
//   pnpm sidecar:build       (first, produces build/index.cjs)
//   pnpm sidecar:build:bin   (this script: pkg the .cjs into a native binary)

import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = resolve(__dirname, '..');
const tauriRoot = resolve(sidecarDir, '..');
const binariesDir = join(tauriRoot, 'src-tauri', 'binaries');

function rustTriple() {
  const out = execSync('rustc -vV', { encoding: 'utf8' });
  const m = out.match(/host:\s*(\S+)/);
  if (!m) throw new Error('cannot determine rust host triple');
  return m[1];
}

function pkgTarget(triple) {
  // map host triple to pkg target slug (always node20)
  if (triple.includes('apple-darwin')) {
    if (triple.startsWith('aarch64')) return 'node20-macos-arm64';
    return 'node20-macos-x64';
  }
  if (triple.includes('windows')) {
    if (triple.startsWith('aarch64')) return 'node20-win-arm64';
    return 'node20-win-x64';
  }
  if (triple.includes('linux')) {
    if (triple.startsWith('aarch64')) return 'node20-linux-arm64';
    return 'node20-linux-x64';
  }
  throw new Error(`unsupported triple ${triple}`);
}

const triple = rustTriple();
const target = pkgTarget(triple);
const ext = triple.includes('windows') ? '.exe' : '';
const outName = `sidecar-${triple}${ext}`;
const outPath = join(binariesDir, outName);

mkdirSync(binariesDir, { recursive: true });
mkdirSync(join(sidecarDir, 'build'), { recursive: true });

// 1) esbuild bundle (mirror of the `build` script; re-run to ensure freshness)
console.log('[bundle] esbuild');
execSync(
  'npx esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=build/index.cjs',
  { cwd: sidecarDir, stdio: 'inherit' },
);

// 2) pkg compile
console.log(`[pkg] target=${target} -> ${outPath}`);
const tmp = join(sidecarDir, 'build', `sidecar${ext}`);
try { rmSync(tmp); } catch {}
execSync(`npx @yao-pkg/pkg build/index.cjs --target ${target} --output ${tmp}`, {
  cwd: sidecarDir,
  stdio: 'inherit',
});

copyFileSync(tmp, outPath);
console.log(`[ok] ${outPath}`);
