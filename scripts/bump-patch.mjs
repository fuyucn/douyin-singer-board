// bump patch version across all version sources.
// rule: only patch can be auto-bumped; major/minor are user-only.
//
// usage: pnpm bump   (or: node scripts/bump-patch.mjs)

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  { path: 'package.json', kind: 'json', key: 'version' },
  { path: 'sidecar/package.json', kind: 'json', key: 'version' },
  { path: 'src-tauri/tauri.conf.json', kind: 'json', key: 'version' },
  { path: 'src-tauri/Cargo.toml', kind: 'toml-version' },
];

function bumpPatch(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`bad version ${v}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function readJsonVersion(path, key) {
  const obj = JSON.parse(readFileSync(path, 'utf8'));
  return { obj, ver: obj[key] };
}

function writeJsonVersion(path, obj, key, ver) {
  obj[key] = ver;
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function readTomlVersion(path) {
  const txt = readFileSync(path, 'utf8');
  const m = /^version\s*=\s*"([^"]+)"/m.exec(txt);
  if (!m) throw new Error(`no version in ${path}`);
  return { txt, ver: m[1] };
}

function writeTomlVersion(path, txt, ver) {
  writeFileSync(path, txt.replace(/^version\s*=\s*"[^"]+"/m, `version = "${ver}"`), 'utf8');
}

let current = null;
for (const t of targets) {
  const full = resolve(root, t.path);
  let ver;
  if (t.kind === 'json') ver = readJsonVersion(full, t.key).ver;
  else ver = readTomlVersion(full).ver;
  if (current === null) current = ver;
  if (current !== ver) {
    console.error(`✗ version mismatch: ${t.path} = ${ver}, expected ${current}`);
    process.exit(1);
  }
}

const next = bumpPatch(current);
console.log(`bumping ${current} -> ${next}`);

for (const t of targets) {
  const full = resolve(root, t.path);
  if (t.kind === 'json') {
    const { obj } = readJsonVersion(full, t.key);
    writeJsonVersion(full, obj, t.key, next);
  } else {
    const { txt } = readTomlVersion(full);
    writeTomlVersion(full, txt, next);
  }
  console.log(`  updated ${t.path}`);
}

console.log(`done: ${next}`);
