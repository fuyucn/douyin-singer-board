# SUSUSingBoard

A small desktop tool that watches a Douyin live room's chat, matches song-request danmu, and shows them in a real-time list. Personal-use project.

## What it does

When a streamer goes live, viewers type things like `点歌 周杰伦` in chat. This app connects to the room's WebSocket, recognizes the song-request pattern, extracts the song name, and shows it in a list. Built-in: per-user cooldown, fans-club level filter, dedup by song name, copy single / copy all, manual add, clear.

## Stack

- Tauri 2 (Rust shell + WebView frontend)
- React + Vite + TypeScript + Zustand
- SQLite via `tauri-plugin-sql` (config + history persistence)
- Node sidecar running [`douyin-danma-listener`](https://www.npmjs.com/package/douyin-danma-listener) for Douyin WSS / signature / protobuf

## Run (dev)

```bash
pnpm install
pnpm tauri:dev
```

## Package

```bash
pnpm tauri:build
```

Outputs:
- macOS: `src-tauri/target/release/bundle/dmg/*.dmg`
- Windows: `src-tauri/target/release/bundle/{msi,nsis}/*`

Cross-compile is not supported (pkg builds the sidecar for the host triple, cargo also can't cross). To build for Windows, run on Windows, etc.

## Install (macOS)

The build is **unsigned**, so macOS Gatekeeper will quarantine the `.app` after
you copy it out of the DMG and refuse to open it ("the app is damaged" or
"can't be opened because Apple cannot check it for malicious software").

After dragging `SUSUSingBoard.app` into `/Applications`, run:

```bash
sudo xattr -cr "/Applications/SUSUSingBoard.app"
```

This strips the quarantine xattr that Gatekeeper added on download. One-time
fix per install.

## Configuration (in the app's UI)

- **Douyin room ID** — the number in `https://live.douyin.com/{this}`
- **Song-request template** — default `点歌[space][song]`. Placeholders:
  - `[space]` = one or more whitespace characters (consecutive `[space]` collapse to one)
  - `[song]` = song-name capture
  - Other characters match literally. e.g. `点歌:[song]` requires a literal colon, no whitespace.
  - Legacy Chinese placeholders `[空格]`/`[歌曲]`/`[歌名]` are still accepted.
- **Min fans-club level** — 0 = no restriction

Click **Start** to connect, **Stop** to disconnect. Each Start clears the on-screen list (DB history is preserved).

## License

GPLv3 (transitive from `douyin-danma-listener`)
