# SUSUSongBoard - AI Collaboration Rules

## Versioning (important)

Format: **`major.minor.patch`** (semver), with an optional custom-edition suffix `-susu.<x>`.

- Mainline (`main`) releases use `0.<N>.0` (e.g. `0.40.0`, then `0.41.0`, `0.42.0`). `major` and the mainline `minor` (`N`) are user-only; AI must never auto-change them.
- `feat/susu` is the development/custom edition. It mirrors the current mainline version with a custom-edition suffix: `0.<N>.0-susu.<x>` (e.g. `0.40.0-susu.1`, `0.41.0-susu.1`). AI may auto-bump `x` with `pnpm bump`.
- `main` is the canonical source for all common code and features. `feat/susu` tracks `main` and only adds SUSU-only customizations: `kugou_enabled` defaults to ON and SUSU-only assets; on `main`, the same code ships with `kugou_enabled` defaulting to OFF.
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

## Branch rules (important)

`feat/susu` is a **permanently custom development edition** — it contains special customizations that must never be merged back into `main`.

- **Never** merge `feat/susu` → `main`, under any circumstances.
- `feat/susu` must track `main`'s code and features; only the `-susu.<x>` version suffix, the `kugou_enabled` default, and SUSU-only customizations may differ.
- The only allowed direction is `main` → `feat/susu`, and **only** when the user explicitly asks to bring a specific feature from `main` into `feat/susu`.
- If asked to do a general merge or sync between these two branches, refuse and ask the user to clarify which specific commits from `main` they want cherry-picked.

## Workflow

1. Make code changes
2. Bump version: on `feat/susu`, run `pnpm bump` (`0.<N>.0-susu.<x>` → `0.<N>.0-susu.<x+1>`); on `main`, set the user-specified `0.<N>.0` across all version sources.
3. `git add -A && git commit -m "..."`
4. `git push`
5. (optional) trigger the Release GitHub Actions workflow; artifacts include the new version in their filenames
