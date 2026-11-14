# SUSUSongBoard

Douyin live-room song request board. This branch (`nsh`) ships the **Native Shell**
rewrite only: native views, SQLite storage, KuGou and NetEase Cloud Music as
WebView plugins, and a self-update from GitHub Releases.

- **Source**: `nsh/` — `Board.tsx` is the entry; `nsh/native` is the Rust crate
  behind `app/sqlite` and the raw `set-cookie` HTTP primitive.
- **Build / test**: from `nsh/`:

  ```sh
  nsh build Board.tsx
  nsh test <suite>.test.tsx            # headless
  nsh test <suite>.test.tsx --target macos   # real renderer
  nsh package Board.tsx --target macos -o dist
  ```

  Details, parity notes and release steps: `nsh/README.md` and
  `nsh/docs/PARITY.md`. Repository-wide rules: `AGENTS.md`.
- **Releases**: tags `v<version>` publish signed macOS (arm64/Intel) and
  Windows (zip, Portable exe, Setup exe) archives through `NSH Release`; the app
  updates itself from `releases/latest/download/`.
- **Platforms**: `plugins/kugou-web/` and `plugins/netease-web/`; the list of
  bundled plugins is installed/upgraded in `${dataDir}/plugins/`.

The original Tauri app lives on `main` / `feat/susu` and is not part of this
branch.
