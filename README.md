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

## Current state

- P0 shell: header, room/settings panel, song table, log panel, manual add,
  simulated request.
- Matcher: `[space]` / `[song]` templates, fans level, per-user cooldown,
  cancel, blacklist.
- Listener: Douyin WSS (nightly required for the `Cookie` handshake header).
- Kugou adapter remains under `plugins/kugou/`; not wired into the board UI yet.

See `docs/PARITY.md` for the Windows gate and P0–P3 plan.
