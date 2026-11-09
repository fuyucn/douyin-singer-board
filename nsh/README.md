# SUSUSongBoard · NSH rewrite

NSH (Native Shell) rewrite of `douyin-singer-board`. Windows is the primary
target; macOS is the development target. The Tauri app remains the shipping
version until parity is signed off.

## Run

```sh
nsh run Board.tsx --target macos
nsh test board.test.tsx
nsh test parity.test.tsx
nsh test sync-worker.test.tsx
nsh test src/matcher.test.ts
nsh test src/autoSync.test.ts
```

## Build

```sh
nsh package Board.tsx --target macos -o dist --name SUSUSongBoard
```

Windows builds must run on Windows (Explorer icon embedding and runtime tests):

```powershell
# CI installs nightly through the GitHub API because the release CDN's
# .sha256 sidecar currently returns 504. For a local Windows build:
gh release download nightly --repo longbridge/nsh `
  --pattern "nsh-windows-x86_64.zip" --dir $env:TEMP --clobber
# Unpack nsh/bin/nsh.exe and nsh/runtime/ into %LOCALAPPDATA%\nsh, add
# %LOCALAPPDATA%\nsh\bin to PATH, then:
nsh package Board.tsx --target windows -o dist --name SUSUSongBoard
```

For inspection only, a Windows zip can be cross-packaged on macOS with a
Windows nightly runtime:

```sh
NSH_RUNTIME=/path/to/nsh-windows/runtime nsh package Board.tsx \
  --target windows -o dist --name SUSUSongBoard
```

The exe then keeps the default Explorer icon.

## Windows artifacts

CI builds three shapes:

- `SUSUSongBoard-Portable-0.6.2.exe` — one file, ~15 MB; first run extracts to
  `%LOCALAPPDATA%\Programs\SUSUSongBoard`, later runs launch directly.
- `SUSUSongBoard-Setup-0.6.2.exe` — per-user NSIS installer, same directory.
- `SUSUSongBoard.zip` — raw directory, ~22 MB.

CI also smoke-runs the portable exe and checks the payload is extracted.

## Current state

- Original layout: header (logo, status, theme toggle, settings, start/stop),
  left settings panel, 点歌 / 已点歌单 / 黑名单 tabs, song table, log, manual
  add; config persisted with `Storage`; light/dark/system appearance; colors use the original shadcn tokens from `theme.json`.
- Matcher: `[space]` / `[song]` templates, fans level, per-user cooldown,
  cancel, blacklist, per-user max.
- 已点: select a row and mark it, or double-press it; copy/clear the played list.
- 黑名单: song names and singer names (Kugou artist match), add/remove with
  timestamps; persisted in config with defaults for older configs.
- Eager Kugou search cache (two concurrent lookups) shows the found artist,
  pending/not-found/error state, and red blocked rows in the song table.
- Background auto-sync worker: one `SyncLedger` idempotency key per request,
  3–5 s cycle, exponential backoff, blacklist/cooldown/per-user-limit skips,
  auth-failure circuit breaker, and clean teardown on config/session changes.
  Manual "mark played" takes over an in-flight worker task, never double-adds.
- About dialog: version, repository, and `nsh/updater` check (no manifest yet).
- Footer elapsed-time stat; `kugou_enabled` gates all Kugou UI and workers.
- Settings dialog: appearance and a platform plugin picker with exactly one
  active plugin (Kugou, or the NetEase placeholder). Kugou management (QR
  login, playlist picker, search, add to playlist/list, auto-sync) lives there.
  Token/userid are kept in `Storage`, not in the repo. Icons are drawn as plain
  function calls so their SVG colors follow theme changes.
- Listener: Douyin WSS (nightly required for the `Cookie` handshake header).
- All icon-bearing buttons go through `ui.tsx` `IconButton()`; all raw text
  buttons carry `items-center justify-center` (NSH's Button is an unstyled
  column host, shadcn's is inline-flex centered). `geometry.test.tsx` asserts
  icon/button center deltas <= 1pt at five sizes, `text-layout.test.tsx`
  asserts fixed-height text labels are centered, and
  `scripts/check_icon_buttons.py` guards both source invariants.
  See `docs/PARITY-SIZES.md` for the measured comparison.
- Windows CI: matcher + auto-sync unit tests, UI + parity + worker + geometry
  tests, icon-button source guard, Cookie header + WS write/read, package,
  installer, portable smoke. The
  live Douyin handshake, QR login and Kugou search API steps are non-blocking
  (they depend on external services), so a green run does not prove those
  passed. Windows-side Chinese font fallback, DPI scaling and full chat-frame
  decoding are still unverified.
- The left panel shows only the active plugin's summary (Kugou playlist and
  auto-sync); management is in Settings. Token refresh/user info are still
  missing. The plugin is compiled in; there is no runtime plugin host yet.
- Auto-update is not configured yet; the portable wrapper can be replaced by a
  newer single file, which re-extracts its newer payload.

See `docs/PARITY.md` for the Windows gate and P0–P3 plan.
