# NSH migration — parity plan (Windows first)

Target: match `douyin-singer-board` **main** (normal edition) in look and behavior,
then bring `feat/susu` customizations back on top. **Windows is the primary
release target**; macOS is the development and secondary target.

The old Tauri repo stays the shipping version until parity is signed off. This
repo is the NSH rewrite; it is not merged into `main` of the old repo yet.

Branches:

- `main` — POC: Douyin listener + Kugou adapter (search, QR key/check).
- `feat/align-main` — this plan; port main's UI and features.
- `feat/susu` — later: susu branding, defaults, kugou-on-by-default.

## Already validated (POC)

- Douyin room HTML -> `id_str` -> MD5/X-Bogus signature -> WSS handshake
  (Cookie/UA/Origin/Referer) -> gzip -> protobuf -> `chat` / `member` / `gift` /
  `like` / `stats`.
- 90 s soak: 41 frames, 10 chat lines, 0 error, 0 close.
- Kugou: `search` (6 results), `qrKey`, `qrCheck` (status 1) — direct API, no
  Node/express.
- Old app's Kugou token still valid: 5 playlists incl. `测试4` (listid 27),
  so playlist APIs can be tested without scanning.

>>> STATUS: P0 shell and P1 core are built in `Board.tsx`: header, settings,
> tabs for 点歌 / 已点 / 黑名单, song table, log, manual add, simulated request,
> mark-played/delete, blacklist add/remove, config persistence, matcher and
> listener wiring. macOS test passes. Windows CI is green: matcher unit test,
> UI test (tabs, mark-played, blacklist), Cookie handshake (with WS write/read),
> live Douyin handshake, packaging, NSIS installer, single-file portable exe,
> and a smoke run that extracts and launches the app.

## Windows gate (must pass before calling anything done)

- Windows 10 1809+ / Windows 11; native Direct2D window, no WebView2 needed for
  this UI.
- Build and UI-test on Windows only: `nsh package --target windows` on macOS
  works with a downloaded Windows runtime, but the icon is not embedded and the
  runtime cannot run here. Release builds run on `windows-latest`.
- Nightly NSH is mandatory: stable 0.4.0 refuses the Douyin WebSocket `Cookie`
  header; nightly 0.4.0 (`36b9168`) allows it on native hosts (same core on
  Windows, still to be proven on a real Windows box).
- Deliverable shape: a single-file portable exe is the chosen Windows form
  factor. `installer/portable.nsi` wraps the NSH directory: first run extracts
  to `%LOCALAPPDATA%\Programs\SUSUSongBoard`, later runs launch it directly.
  A registry build marker keeps an updated app from being overwritten by an
  older launcher. Also build a per-user NSIS installer and the raw zip.
  Measured: portable 15 MB, installer 15 MB, zip 22 MB (old single exe 52.6 MB).
- Auto-update: `nsh/updater` full package (~23 MB), no binary delta; install in
  a user-writable directory, otherwise `canInstall` is false. Sign with
  `signtool` to reduce SmartScreen friction.
- Test matrix on Windows: WSS handshake with Cookie (green), WS write/read
  (green), UI shell (green), live Douyin room handshake (green), portable
  extract/launch (green). Still to check: live chat frames/protobuf on a
  Windows box, Chinese font fallback, 100/125/150% DPI, proxy/offline errors,
  paths with spaces/Chinese characters, updater replace-and-restart, code
  signing.
- The code lives on branch `nsh` of `fuyucn/douyin-singer-board`, under `nsh/`;
  `main` and `feat/susu` are untouched. Windows CI is
  `.github/workflows/nsh-windows.yml`.

## P0 — style and layout (3–5 days)

Port the visual shell from `src/styles.css` and `src/App.tsx`:

- Tokens: background `#f4f6f8`, foreground `#191d24`, card `#ffffff`,
  primary `#2f6fb0`, muted `#e3e7ec`, border `rgba(25,31,42,.12)`,
  radius `0.4rem`, system font stack, dark theme tokens.
- Layout: header (logo, room, connection status), left panel (settings/stats),
  main song table, bottom log panel, narrow (<720 px) layout.
- Components: table headers, row actions, context menu, dialogs, toasts,
  copy/clear/manual add, empty states.

## P1 — core features (5–8 days)

- Song-request template parser (`[space]` / `[song]`, legacy Chinese placeholders).
- Per-user cooldown, fans-club level filter, dedup by song, max songs per user.
- Config persistence (room, template, fans, cooldown, max per user, kugou switch,
  target playlist), session history, manual add, copy single/all, clear.
- Listener wired to the table: chat -> match -> row; cancel/recall; session stats.

## P2 — panels, blacklist, history, polish (3–5 days)

- Blacklist (add/remove, filters), history list, log panel, session stats.
- Theme (light/dark/system), about, telemetry opt-in, update check placeholder.
- Keyboard shortcuts, responsive layout, empty/error states.

## P3 — susu + Kugou + plugin host (1–2 weeks)

- `feat/susu`: branding, default room `767116735823`, kugou enabled by default.
- Kugou: token persistence, login QR, search, playlist picker, add to playlist,
  optional auto-sync on mark-played are in `Board.tsx` (`0.3.0`). Still missing:
  token refresh, user info, history/listen bias, playlist clear/recreate,
  in-app QR confirmation beyond status polling.
- Plugin host: NSH hidden AppView + host.send/host.call RPC, manifest, install,
  per-plugin storage/permissions. Until then, Kugou is a directly imported
  module (`plugins/kugou/`), not an isolated plugin.

## Known constraints

- NSH nightly (0.4.0, `36b9168`) is required for WebSocket `Cookie` headers;
  stable 0.4.0 refuses them.
- NSH has no dmg / portable single exe / installer; packaging is `.app`
  (ad-hoc signed) and Windows directory + zip. Installer and signing are
  release-engineering work, not optional polish for Windows.
- Cross-packaging Windows on macOS works with `NSH_RUNTIME` pointing at the
  Windows nightly runtime, but embedding the Explorer icon and real runtime
  tests need Windows.
- Kugou `user_detail` / token refresh need RSA/AES; playlist add needs token
  and android signature. Old token can cover read-only tests now.
