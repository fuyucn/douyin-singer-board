# SUSUSongBoard · NSH rewrite

NSH (Native Shell) rewrite of `douyin-singer-board`. Windows is the primary
target; macOS is the development target. The Tauri app remains the shipping
version until parity is signed off.

## Run

```sh
nsh run Board.tsx --target macos
nsh test board.test.tsx
nsh test src/matcher.test.ts
```

## Build

```sh
nsh package Board.tsx --target macos -o dist --name SUSUSongBoard
```

Windows builds must run on Windows (Explorer icon embedding and runtime tests):

```powershell
$env:NSH_VERSION = "nightly"
irm https://nsh.dev/install.ps1 | iex
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

- `SUSUSongBoard-Portable-0.1.0.exe` — one file, ~15 MB; first run extracts to
  `%LOCALAPPDATA%\Programs\SUSUSongBoard`, later runs launch directly.
- `SUSUSongBoard-Setup-0.1.0.exe` — per-user NSIS installer, same directory.
- `SUSUSongBoard.zip` — raw directory, ~22 MB.

CI also smoke-runs the portable exe and checks the payload is extracted.

## Current state

- P0/P1 shell: header, room/settings panel, tabs for 点歌 / 已点 / 黑名单,
  song table, log panel, manual add, simulated request; config persisted with
  `Storage`.
- Matcher: `[space]` / `[song]` templates, fans level, per-user cooldown,
  cancel, blacklist, per-user max.
- 已点: select a row and mark it, or double-press it; copy/clear the played list.
- 黑名单: add/remove exact song names in the UI; persisted in config.
- Listener: Douyin WSS (nightly required for the `Cookie` handshake header).
- Windows CI: matcher, UI, Cookie header + WS write/read, live Douyin room
  handshake, package, installer, portable smoke.
- Kugou adapter remains under `plugins/kugou/`; not wired into the board UI yet.
- Auto-update is not configured yet; the portable wrapper can be replaced by a
  newer single file, which re-extracts its newer payload.

See `docs/PARITY.md` for the Windows gate and P0–P3 plan.
