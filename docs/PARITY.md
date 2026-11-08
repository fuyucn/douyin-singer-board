# NSH migration — parity plan

Target: match `douyin-singer-board` **main** (normal edition) in look and behavior,
then bring `feat/susu` customizations back on top.

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
- Kugou: token persistence, user info, playlists, add to playlist, auto-sync,
  login QR in-app.
- Plugin host: NSH hidden AppView + host.send/host.call RPC, manifest, install,
  per-plugin storage/permissions. Until then, Kugou is a directly imported
  module (`plugins/kugou/`), not an isolated plugin.

## Known constraints

- NSH nightly (0.4.0, `33f1015`) is required for WebSocket `Cookie` headers;
  stable 0.4.0 refuses them.
- NSH has no dmg / portable single exe; packaging is `.app` (ad-hoc signed) and
  Windows directory + zip. Release engineering is a later phase.
- Kugou `user_detail` / token refresh need RSA/AES; playlist add needs token
  and android signature. Old token can cover read-only tests now.
