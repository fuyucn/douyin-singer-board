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

The repo ships two apps. The versioning, branch and release rules above describe the Tauri app on `main` and `feat/susu`. The native rewrite lives on the `nsh` branch and shares neither its version sources (`nsh/nsh.json`) nor its data layer. Its version tracks the mainline series as a preview instead of numbering itself: with the Tauri app at `0.42.1`, the NSH releases are `0.43.0-preview.<n>`, the next minor marked as a prerelease.

- **Where**: `nsh/` (`Board.tsx` is the entry, `nsh/native` is the Rust crate behind `app/sqlite`), built and packaged by the NSH CLI. Docs: `nsh/README.md`, parity notes in `nsh/docs/PARITY.md`.
- **Build/test**: run from `nsh/`, never from the repo root (cargo discovers `nsh/.cargo/config.toml` by walking up from the current directory): `nsh build Board.tsx`, `nsh test <file>.test.tsx`, `nsh test <file>.test.tsx --target macos` for the real renderer, `nsh package Board.tsx --target macos -o dist`.
- **Version sources** (kept in sync by `python3 nsh/scripts/check_versions.py`, which CI and the release workflow run): `nsh/nsh.json` (`version`, `build`), `nsh/Board.tsx`'s `APP_VERSION`, `nsh/installer/installer.nsi` and `portable.nsi` (`APP_VERSION`, `APP_BUILD`, `VIProductVersion`), the artifact names in `.github/workflows/nsh-windows.yml` and `nsh/README.md`, and the version string in `nsh/parity.test.tsx`. Bump all of them together. `build` must stay an integer 0..65535: NSIS takes `VIProductVersion` as four numbers and the fourth is `build`, so the installer's file version keeps rising across previews.
- **Releases**: tag `v<version>` on `nsh` (the tag must match `nsh.json`) and `NSH Release` builds macOS arm64, macOS Intel and Windows archives on their own runners, signs `latest.json` with the `NSH_UPDATE_KEY` secret (its public half is `nsh.json`'s `updater.publicKey`) and attaches everything to the GitHub release. The app updates itself from `releases/latest/download/`. **Never mark an NSH release as a GitHub prerelease**, whatever the version string says: `latest` skips prereleases, so the update chain would silently fall back to the previous release. The updater never downgrades either, so a version bump is one-way for installed apps.
- **Plugin channel**: third-party code can only run in a **WebView** — the main VM has no `eval`, refuses `.nshc` it did not build, and bundles everything at build time, so there is no way to run a module loaded at runtime. `nsh/src/plugin/` wraps a plugin's module (`${dataDir}/plugins/<id>/plugin.json` + entry) in a page, runs it in a hidden `display: none` WebView (which still loads and keeps full-rate timers), and talks to it over `window.nsh.postMessage` / `injectJavaScript`. The app declares `capabilities.webview` for that alone; Windows needs the WebView2 runtime when a plugin is used. The built-in platforms are compiled in and must not depend on the bridge.
- **Storage**: the app owns its SQLite schema (`config`, `blacklist`, `kugou_session`, `settings`, `meta`, `PRAGMA user_version`), in `${dataDir}/sususongboard.db`. The first launch imports the old Tauri database through a verified temp copy and snapshots it into `sqlite-backups/`. Never write `storage.json`, never reintroduce the old `nsh_kv` table, and change the schema only by bumping `user_version`/`meta.schema` plus a migration in `nsh/native/src/store.rs`.
- **Tests that must stay green**: `cargo test --locked` in `nsh/native`, the headless `nsh test` suites, the `--target macos` renderer tests, `scripts/check_icon_buttons.py`, `scripts/check_versions.py`, and the playlist KAT (`nsh test scripts/kat-playlist.test.ts > kat.txt 2>&1 && node scripts/kat-playlist.mjs kat.txt`; the KAT prints on stderr).

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

1. Make code changes
2. Bump version: on `feat/susu`, run `pnpm bump` (`0.<N>.0-susu.<x>` → `0.<N>.0-susu.<x+1>`); on `main`, set the user-specified `0.<N>.0` across all version sources.
3. `git add -A && git commit -m "..."`
4. `git push`
5. (optional) trigger the Release GitHub Actions workflow; artifacts include the new version in their filenames
