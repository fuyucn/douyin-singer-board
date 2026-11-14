# SUSUSongBoard — Claude Rules

This branch (`nsh`) ships the Native Shell app only. The Tauri app is on
`main` / `feat/susu` and its files are not here.

**`AGENTS.md` is authoritative**; read it before changing code. Short version:

- **Entry**: `nsh/Board.tsx`. Native crate: `nsh/native` (`app/sqlite`,
  `Net.fetchRaw`). Platforms are WebView plugins under `nsh/plugins/`.
- **Commands** (from `nsh/`, after `source ~/.nsh-build/env.sh`):

  ```sh
  nsh build Board.tsx
  nsh test <file>.test.tsx
  nsh test <file>.test.tsx --target macos
  nsh test <file>.test.tsx --target windows
  nsh package Board.tsx --target macos -o dist --name SUSUSongBoard
  ```

  A test VM has no filesystem/data dir; plugin and platform suites need
  `--target`.
- **Versions**: previews (`0.43.0-preview.<n>`) and stable (`0.43.2`) are
  both normal. `python3 scripts/check_versions.py` lists every source to bump
  (`nsh.json`, `Board.tsx` `APP_VERSION`, both `.nsi`, workflow artifact names,
  `README.md`, `parity.test.tsx`). Never auto-change major/minor.
- **Release**: tag `v<version>` on `nsh`; `NSH Release` builds and signs all
  platforms. Never mark it a GitHub prerelease (`latest` skips those), and the
  updater never downgrades.
- **Storage**: `${dataDir}/sususongboard.db`, app-owned schema; first launch
  imports the old Tauri DB. Never write `storage.json` or revive `nsh_kv`; schema
  changes go through `native/src/store.rs` migrations.
- **Language**: source/comments/logs/docs in English; UI may be Chinese.
- **Workflow**: edit a batch, one build, targeted tests, one full sweep,
  commit, push; release only when asked. Run `~/.nsh-build/clean.sh` after a
  release; never put caches in `/tmp`.
