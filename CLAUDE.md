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

## Workflow

1. Make code changes
2. `pnpm bump` (patch +1)
3. `git add -A && git commit -m "..."`
4. `git push`
5. (optional) trigger the Release GitHub Actions workflow; artifacts include the new version in their filenames
