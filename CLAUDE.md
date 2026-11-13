# SUSUSongBoard - AI Collaboration Rules

## Versioning (important)

Format: **`major.minor.patch`** (semver).

- **AI may only auto-bump `patch`**: `0.0.1` → `0.0.2` → ... → `0.0.99` → `0.0.100`
- **`major` and `minor` are user-only**. Claude must NOT auto-change major/minor even on breaking changes.
- After any code change, run `pnpm bump` to sync the four version sources, then commit.
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

## Branch rules (important)

`feat/kugou-search` is a **permanently custom branch** — it contains special customizations that must never be merged back into `main`.

- **Never** merge `feat/kugou-search` → `main`, under any circumstances.
- The only allowed direction is `main` → `feat/kugou-search`, and **only** when the user explicitly asks to bring a specific feature from `main` into `feat/kugou-search`.
- If asked to do a general merge or sync between these two branches, refuse and ask the user to clarify which specific commits from `main` they want cherry-picked.

## NSH app (branch `nsh`)

`AGENTS.md` is authoritative when this file and the code disagree. Since the native rewrite the repo also ships an NSH app on the `nsh` branch:

- `nsh/Board.tsx` is the entry; `nsh/native` is the Rust crate behind the `app/sqlite` module.
- Build and test from `nsh/`: `nsh build Board.tsx`, `nsh test <file>.test.tsx`, `nsh test <file>.test.tsx --target macos`, `nsh package Board.tsx --target macos -o dist`. Cargo discovers `nsh/.cargo/config.toml` from the working directory, so the repo root builds differently.
- Its version follows the mainline (preview lines like `0.43.0-preview.<n>` and stable ones like `0.43.2` are both normal) and lives in `nsh/nsh.json` plus the strings `python3 nsh/scripts/check_versions.py` checks (`Board.tsx`'s `APP_VERSION`, both `.nsi` files, workflow artifact names, `parity.test.tsx`, `nsh/README.md`). `pnpm bump` does not touch it.
- Development order: edit the whole batch, then one `nsh build`, then `--filter`ed tests, then one full sweep, then one `nsh package` and one release. A test file's VM has no filesystem; plugin/platform suites need `--target`.
- Build environment: `source ~/.nsh-build/env.sh` (toolchain + `CARGO_TARGET_DIR` outside `/tmp`). After a release run `~/.nsh-build/clean.sh`; delete `~/.nsh-build/target` + cargo registry only when space is wanted.
- Tag `v<version>` on `nsh` publishes a release through `NSH Release` (signed `latest.json` + macOS/Windows archives); the app updates itself from `releases/latest/download/`. Never mark that release as a GitHub prerelease — `latest` skips those and the update chain would go quiet.
- Storage is the app's own SQLite schema in `${dataDir}/sususongboard.db` (`config`, `blacklist`, `kugou_session`, `settings`, `meta`). Old Tauri data is imported once at first launch. Do not write `storage.json` and do not restore the old `nsh_kv` table.

## Workflow

1. Make code changes
2. `pnpm bump` (patch +1)
3. `git add -A && git commit -m "..."`
4. `git push`
5. (optional) trigger the Release GitHub Actions workflow; artifacts include the new version in their filenames
