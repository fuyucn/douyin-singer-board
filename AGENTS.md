# SUSUSongBoard — AI Collaboration Rules (`nsh` branch)

This branch ships the Native Shell app only. The Tauri app lives on `main` /
`feat/susu`; its files, version sources and release workflow are not here.

## Versioning

NSH follows the mainline series; it may ship a preview
(`0.43.0-preview.<n>`) or a stable version (`0.43.2`). Both are normal releases.
`major`/`minor` are user-owned: do not change them without being asked.

Version sources, kept in sync by `python3 scripts/check_versions.py` (run it
from `nsh/`; CI and the release workflow also run it):

- `nsh.json` — `version`, `build`
- `Board.tsx` — `APP_VERSION`
- `installer/installer.nsi`, `installer/portable.nsi` — `APP_VERSION`,
  `APP_BUILD`, `VIProductVersion`
- artifact names in `.github/workflows/nsh-windows.yml` and `README.md`
- the version string in `parity.test.tsx`

Bump all of them together. `build` stays an integer 0..65535: NSIS reads
`VIProductVersion` as four numbers and its fourth is `build`, so installer file
versions keep rising.

## Language

Source files (code, comments, logs, README, this file) are **English**.
End-user UI strings may stay in Chinese (the app targets Chinese Douyin
streamers). User-facing failure reports are written in Simplified Chinese.

## Build and test

Run from `nsh/`, never the repo root (cargo finds `nsh/.cargo/config.toml` by
walking up):

```sh
source ~/.nsh-build/env.sh
nsh build Board.tsx
nsh test <file>.test.tsx                  # headless
nsh test <file>.test.tsx --target macos  # real renderer
nsh test <file>.test.tsx --target windows
nsh package Board.tsx --target macos -o dist --name SUSUSongBoard
```

`nsh test` takes one path (a file or a directory). A test file's VM has no
filesystem and no data directory: anything that installs a plugin or reads
`process.dataDir` must use `--target`. Manual-clock (`clock: {}`) suites need
a real-time wait before their first platform call, because the plugin page
runs on real time.

**Fast iteration loop**: edit a whole batch first, then build once, then test
by blast radius — not after every edit.

1. Edit everything for the step (no build in between).
2. One `nsh build Board.tsx`.
3. Targeted tests with `--filter` for the part touched, e.g.
   `nsh test actions.test.tsx --filter "auto-sync"`.
4. One full sweep before committing: headless suites, `--target` renderer
   suites, KATs, guards.
5. One `nsh package`; one release. CI wait dominates, so never release per
   small fix.

Warm build ≈ 1 s, `cargo test` in `native/` ≈ 0.5 s, package ≈ 3 s. Only Rust
changes force a recompile. Caches live in `~/.nsh-build` (never `/tmp`; the OS
cleans it). After a release run `~/.nsh-build/clean.sh`; remove
`~/.nsh-build/target` and the cargo registry only when reclaiming space, and
keep `rustup`.

## Storage

The app owns its SQLite schema (`config`, `blacklist`, `kugou_session`,
`settings`, `meta`, `PRAGMA user_version`) in `${dataDir}/sususongboard.db`.
The first launch imports the old Tauri database through a verified temp copy
and snapshots it into `sqlite-backups/`. Never write `storage.json`, never
reintroduce `nsh_kv`, and change schema only by bumping
`user_version`/`meta.schema` plus a migration in `native/src/store.rs`.

## Plugins

Third-party code runs only in a **WebView**: the main VM has no `eval`, refuses
`.nshc` it did not build, and bundles everything at build time. `src/plugin/`
wraps `${dataDir}/plugins/<id>/plugin.json` + entry in a page, runs it in a
hidden `display: none` WebView (timers keep full rate), and talks over
`window.nsh.postMessage` / `injectJavaScript`. `capabilities.webview` exists
for this alone; Windows needs the WebView2 runtime when a plugin is used.

Both platforms are plugins; each is a self-contained package under `plugins/`
with `plugin.json`, `index.js` and `platform.ts`:

- `plugins/kugou-web/` — KuGou API; MD5/AES/RSA are computed in the page.
- `plugins/netease-web/` — weapi search/playlists, eapi QR login, cookie
  session.

`scripts/embed-plugin.mjs` embeds the runtime files (`plugin.json`,
`index.js`) into `src/plugin/*Plugin.ts`; `platform.ts` is skipped and stays
app-side. The KuGou plugin's crypto is checked against Node by
`scripts/kat-kugou-plugin.test.tsx` + `.mjs`. TSX `fetch` hides `Set-Cookie`;
the native `Net.fetchRaw` returns status, body and every `set-cookie` header,
exposed as the bridge primitive `http.raw` (this is what keeps the NetEase
`MUSIC_U` session). A new platform = one package folder + one import in
`Board.tsx`.

## Releases

Tag `v<version>` on `nsh` (it must match `nsh.json`); `NSH Release` builds
macOS arm64, macOS Intel and Windows archives, signs `latest.json` with the
`NSH_UPDATE_KEY` secret (public half in `nsh.json`), attaches everything to the
release. The app updates from `releases/latest/download/`.

**Never mark an NSH release as a GitHub prerelease**, whatever the version
string says: `latest` skips prereleases, so the update chain would fall back to
the previous release. The updater never downgrades; a bump is one-way for
installed apps. Tag names are unique; never overwrite or delete a tag.

## Tests and known gaps

Must stay green: `cargo test --locked` in `native/`, the headless `nsh test`
suites, the `--target macos`/`windows` renderer suites (including
`netease.test.tsx`), `scripts/check_icon_buttons.py`,
`scripts/check_versions.py`, and the KuGou plugin KAT.

Known skipped UI races: `sync-worker.test.tsx` skips auth-failure /
manual-mark / restart / transient-retry, and `actions.test.tsx` skips
log-clear, double-press auto-sync and typing-while-resolving. They assert
in-flight windows whose timing includes a WebView round trip. Do not "fix" them
with sleeps; they need a promise gate. The worker logic is covered by
`src/autoSync.test.ts` and the handlers by the remaining action tests.

## Workflow

1. Make the whole change as a batch.
2. Build once, test targeted first, one full sweep last.
3. Bump the version sources `check_versions.py` checks, then run it.
4. `git add -A && git commit`, `git push`; tag `v<version>` only when releasing.
5. After a successful release, run `~/.nsh-build/clean.sh`.
