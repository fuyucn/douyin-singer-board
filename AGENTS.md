# SUSUSongBoard - AI Collaboration Rules

## Versioning (important)

Format: **`major.minor.patch`** (semver), with an optional custom-edition suffix `-susu.<x>`.

- Mainline (`main`) releases use `0.<N>.0` (e.g. `0.40.0`, then `0.41.0`, `0.42.0`). `major` and the mainline `minor` (`N`) are user-only; AI must never auto-change them.
- `feat/susu` is the development/custom edition. It mirrors the current mainline version with a custom-edition suffix: `0.<N>.0-susu.<x>` (e.g. `0.40.0-susu.1`, `0.41.0-susu.1`). AI may auto-bump `x` with `pnpm bump`.
- `main` is the canonical source for all common code and features. `feat/susu` tracks `main` and only adds SUSU-only customizations: `kugou_enabled` defaults to ON, the default live room id `767116735823`, and SUSU-only assets; on `main`, the same code ships with `kugou_enabled` defaulting to OFF and an empty live room id.
- On `main`, do not run `pnpm bump` for a `0.<N>.0` release; set the user-specified `0.<N>.0` in all version sources together.
- Bump should be part of the change commit (or immediately follow); do not let it lag.

## Version sources (kept in sync by `pnpm bump`)

| File | Field |
|---|---|
| `package.json` | `"version"` |
| `sidecar/package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version = "..."` |

`pnpm bump` (= `node scripts/bump-patch.mjs`) updates all four. Editing one of them by hand without the others will make the script abort with "version mismatch".

## Language

All source files (code comments, log messages, README, this file) are in **English**.
End-user-facing UI strings may stay in Chinese (the app targets Chinese Douyin streamers).

## Database migrations (important)

`tauri-plugin-sql` hashes each migration's SQL text and refuses to run if the
recorded hash does not match. **Never edit a migration that has already been
deployed.** To change schema or seed data:

1. Keep migration v1 (and any other shipped migrations) byte-for-byte stable.
2. Add a new `Migration` entry with a higher `version` number.
3. The new migration runs on next launch and brings existing DBs forward.

If a migration was edited by mistake during early development, the dev fix is
to delete the DB file and let the migration re-run from scratch (the path is
the Tauri app config dir, e.g. `~/Library/Application Support/<identifier>/`).

## NSH app (branch `nsh`) (important)

The Tauri app lives on `main` and `feat/susu` and its files are not present on this branch; the versioning and release rules for it above still describe those branches. The native rewrite lives on the `nsh` branch and shares neither its version sources (`nsh/nsh.json`) nor its data layer. Its version tracks the mainline series instead of numbering itself. It may ship as a preview (`0.43.0-preview.<n>`) or, once a preview line is settled, as a stable version (`0.43.2`); both are normal releases and the same rules below apply. With the Tauri app at `0.42.1`, NSH started at `0.43.0-preview.1` and promoted to `0.43.1` and `0.43.2`.

- **Where**: `nsh/` (`Board.tsx` is the entry, `nsh/native` is the Rust crate behind `app/sqlite`), built and packaged by the NSH CLI. Docs: `nsh/README.md`, parity notes in `nsh/docs/PARITY.md`.
- **Build/test**: run from `nsh/`, never from the repo root (cargo discovers `nsh/.cargo/config.toml` by walking up from the current directory): `nsh build Board.tsx`, `nsh test <file>.test.tsx`, `nsh test <file>.test.tsx --target macos` for the real renderer, `nsh package Board.tsx --target macos -o dist`.
- **Version sources** (kept in sync by `python3 nsh/scripts/check_versions.py`, which CI and the release workflow run): `nsh/nsh.json` (`version`, `build`), `nsh/Board.tsx`'s `APP_VERSION`, `nsh/installer/installer.nsi` and `portable.nsi` (`APP_VERSION`, `APP_BUILD`, `VIProductVersion`), the artifact names in `.github/workflows/nsh-windows.yml` and `nsh/README.md`, and the version string in `nsh/parity.test.tsx`. Bump all of them together. `build` must stay an integer 0..65535: NSIS takes `VIProductVersion` as four numbers and the fourth is `build`, so the installer's file version keeps rising across previews.
- **Releases**: tag `v<version>` on `nsh` (the tag must match `nsh.json`) and `NSH Release` builds macOS arm64, macOS Intel and Windows archives on their own runners, signs `latest.json` with the `NSH_UPDATE_KEY` secret (its public half is `nsh.json`'s `updater.publicKey`) and attaches everything to the GitHub release. The app updates itself from `releases/latest/download/`. **Never mark an NSH release as a GitHub prerelease**, whatever the version string says: `latest` skips prereleases, so the update chain would silently fall back to the previous release. The updater never downgrades either, so a version bump is one-way for installed apps.
- **Plugin channel**: third-party code can only run in a **WebView** — the main VM has no `eval`, refuses `.nshc` it did not build, and bundles everything at build time, so there is no way to run a module loaded at runtime. `nsh/src/plugin/` wraps a plugin's module (`${dataDir}/plugins/<id>/plugin.json` + entry) in a page, runs it in a hidden `display: none` WebView (which still loads and keeps full-rate timers), and talks to it over `window.nsh.postMessage` / `injectJavaScript`. The app declares `capabilities.webview` for that alone; Windows needs the WebView2 runtime when a plugin is used. Both platforms are plugins: `plugins/kugou-web/` (KuGou API) and `plugins/netease-web/` (weapi search/playlists plus eapi QR, cookie session), embedded by `scripts/embed-plugin.mjs`. The KuGou plugin is checked against Node's crypto by `scripts/kat-kugou-plugin.test.tsx` + `.mjs` (a page has no Node `crypto`/`Buffer` and no WebKit `crypto.subtle` outside a secure context, so it computes MD5/AES itself). TSX `fetch` hides `Set-Cookie`; the native crate's `Net.fetchRaw` returns status+body+all `set-cookie` headers, exposed as the bridge primitive `http.raw`, which is what lets the NetEase QR login keep `MUSIC_U`/`__csrf` as the session.
- **Storage**: the app owns its SQLite schema (`config`, `blacklist`, `kugou_session`, `settings`, `meta`, `PRAGMA user_version`), in `${dataDir}/sususongboard.db`. The first launch imports the old Tauri database through a verified temp copy and snapshots it into `sqlite-backups/`. Never write `storage.json`, never reintroduce the old `nsh_kv` table, and change the schema only by bumping `user_version`/`meta.schema` plus a migration in `nsh/native/src/store.rs`.
- **Fast iteration loop (NSH)**: write a batch of changes first, then build once, then test by blast radius — not after every edit.
  1. Edit everything for the step (no `nsh build` in between; a TSX build is ~1 s and tells you nothing until the batch is done).
  2. One `nsh build Board.tsx` — it type-checks and catches the batch's errors together.
  3. Targeted tests with `--filter` for the part you touched (`nsh test actions.test.tsx --filter "auto-sync"` ≈ 9 s instead of 70 s for the file).
  4. One full sweep before committing: the headless suites, then the `--target macos` renderer suites, the KATs and the two guards.
  5. One `nsh package`; one release. Never a release per small fix — the CI wait (~35 min) dominates and cannot be batched away.
  - `nsh test` takes **one** path (a file or a directory), so list them one by one; a directory run is the only way to batch, and the app's test files live next to `Board.tsx` on purpose.
  - A test file's VM has **no filesystem and no data directory**; anything that installs a plugin or reads `process.dataDir` must run with `--target`. Manual-clock (`clock: {}`) suites need a real-time wait before the first platform call, because the plugin page loads on real time while the app clock only moves when the test moves it.
- **Build cache (never in `/tmp`)**: `source ~/.nsh-build/env.sh` first in every shell that builds; it sets `RUSTUP_HOME`, `CARGO_HOME`, `CARGO_TARGET_DIR=~/.nsh-build/target` and `PATH`. `/tmp` gets cleaned by the OS (it once wiped the workspace, the toolchain and `target`). Warm numbers: `nsh build` ≈ 1 s, `cargo test` in `nsh/native` ≈ 0.5 s, `nsh package` ≈ 3 s; cold ≈ 50 s / 3 min. Only Rust changes (`nsh/native/**`, `.cargo/config.toml`) force a recompile.
- **Cleanup after a release**: `~/.nsh-build/clean.sh` removes probe folders, one-off clones and old package archives, then prints `du`/`df`. When the user asks to reclaim space, also remove `~/.nsh-build/target` (≈ 7 GB) and `~/.nsh-build/cargo/registry`+`git` (≈ 0.8 GB) — keeping the toolchain (`~/.nsh-build/rustup`) saves a reinstall, and the next cold build costs ~3–4 min. CI has `actions/cache` for `nsh/target` + `nsh/native/target` keyed by OS, arch and `Cargo.lock`; never cache across arm64 and Intel.
- **Known skipped UI races (NSH)**: `sync-worker.test.tsx` skips its auth-failure / manual-mark / restart / transient-retry cases and `actions.test.tsx` skips log-clear, double-press auto-sync and typing-while-resolving. They assert in-flight windows whose timing now includes a WebView bridge round trip; the worker logic is covered by `src/autoSync.test.ts`, the handlers by the remaining action tests. Do not "fix" them by adding sleeps — they need a gate (a mock that holds a promise) before they can return.
 6510d4a (feat(nsh): platform as a plugin, and one plugin list (0.43.0-preview.6))
- **Tests that must stay green**: `cargo test --locked` in `nsh/native`, the headless `nsh test` suites, the `--target macos` renderer tests (including `netease.test.tsx`), `scripts/check_icon_buttons.py`, `scripts/check_versions.py`, and the KuGou plugin crypto KAT (`nsh test scripts/kat-kugou-plugin.test.tsx --target macos > kat.txt 2>&1 && node scripts/kat-kugou-plugin.mjs kat.txt`).

## Branch rules (important)

`feat/susu` is a **permanently custom development edition** — it contains special customizations that must never be merged back into `main`.

- **Never** merge `feat/susu` → `main`, under any circumstances.
- `feat/susu` must track `main`'s code and features; only the `-susu.<x>` version suffix, the `kugou_enabled` default, the default live room id `767116735823`, and SUSU-only customizations may differ.
- The only allowed direction is `main` → `feat/susu`, and **only** when the user explicitly asks to bring a specific feature from `main` into `feat/susu`.
- If asked to do a general merge or sync between these two branches, refuse and ask the user to clarify which specific commits from `main` they want cherry-picked.

## Releases & auto-update (important)

- (Tauri app only.) The auto-update channel is derived from the version string: a version containing `-` (e.g. `0.41.0-susu.1`) is a prerelease and updates through GitHub prerelease releases; a plain `0.<N>.0` is stable and updates through the latest stable release. This does not apply to the NSH app on `nsh`, whose manifest URL cannot see prereleases.
- (Tauri app only.) The Release workflow reads `package.json` version, tags it `v<version>`, and marks any version containing `-` as `prerelease=true`. Stable releases must not carry a `-` suffix.
- Publish stable releases (`0.<N>.0`) from `main`; publish custom releases (`0.<N>.0-susu.<x>`) from `feat/susu`. Never publish a `feat/susu` build as a plain `0.<N>.0` release.
- Each release uploads the update artifacts: `latest.json`, signed `.app.tar.gz`/`.sig` for macOS, and the portable `.exe` for Windows. Tag names are unique; never overwrite or delete an existing release tag.

## Workflow

1. Make the whole change (a batch, not one edit at a time) — for the NSH app follow **Fast iteration loop** above.
2. Build once, then test: targeted first, one full sweep last. Do not rebuild after every file.
3. Bump version: on `feat/susu`, run `pnpm bump` (`0.<N>.0-susu.<x>` → `0.<N>.0-susu.<x+1>`); on `main`, set the user-specified `0.<N>.0` across all version sources. On `nsh`, bump the sources `nsh/scripts/check_versions.py` checks and run it.
4. `git add -A && git commit -m "..."`
5. `git push` (on `nsh`, tag `v<version>` too, and never mark the release as a GitHub prerelease).
6. (optional) trigger the Release GitHub Actions workflow; artifacts include the new version in their filenames.
7. After a successful release, run `~/.nsh-build/clean.sh`; delete `~/.nsh-build/target` and the cargo registry when space is wanted, never `/tmp` caches (there are none).
