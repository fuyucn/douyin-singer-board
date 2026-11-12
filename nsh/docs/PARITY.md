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

## 0.7.9 app id + SQLite bridge

> The NSH app id is now `com.sususongboard.app`, matching the old Tauri app.
> `process.dataDir` therefore lands in the same app-data directory as
> `sususongboard.db`. With `capabilities.fs.read = ["${dataDir}", "${homeDir}"]`
> and `fs/promises.readFile`, the app can automatically read the old SQLite
> file on first launch. `src/legacyMigration.ts` converts `config` /
> `blacklist` / `kugou_session` into `board.config`, `board.theme` and
> `kugou.session` through the read-only parser in
> `plugins/kugou/sqliteReader.ts`, and writes a `legacyMigrationDone` marker.
> Existing `com.sususongboard.nsh/storage.json` is kept as
> `legacy.nshStorageBackup` when a Tauri database wins, and is used as the
> source only when no Tauri database is found. The old SQLite file is never
> written. This is a read-only migration bridge; a full SQL query API would
> still require a mixed-mode Rust crate.

## Already validated (POC)

- Douyin room HTML -> `id_str` -> MD5/X-Bogus signature -> WSS handshake
  (Cookie/UA/Origin/Referer) -> gzip -> protobuf -> `chat` / `member` / `gift` /
  `like` / `stats`.
- 90 s soak: 41 frames, 10 chat lines, 0 error, 0 close.
- Kugou: `search` (6 results), `qrKey`, `qrCheck` (status 1) — direct API, no
  Node/express.
- Old app's Kugou token still valid: 5 playlists incl. `测试4` (listid 27),
  so playlist APIs can be tested without scanning.

>>> STATUS: P0 shell, P1 core and the original layout are in `Board.tsx`:
> header (theme/settings/start-stop), left settings panel, 点歌 / 已点歌单 /
> 黑名单 tabs, song table, log, manual add, mark-played/delete, blacklist,
> config persistence. Kugou moved out of the main tabs into a Settings dialog (0.5.0), with the original shadcn tokens in `theme.json`
> with a single active platform plugin (Kugou / NetEase placeholder). macOS test passes. Windows CI is green: matcher unit test,
> UI test (tabs, mark-played, blacklist), Cookie handshake (with WS write/read),
> packaging, NSIS installer, single-file portable exe, and a smoke run that
> extracts and launches the app. Live Douyin handshake, QR login and Kugou
> search API are non-blocking CI steps (external services), not guarantees.
>
> 0.6.1/0.6.2 fixes the geometry the user reported three times: NSH's Button
> is an unstyled column host, so every icon-only button goes through
> `ui.tsx` `IconButton()` and every raw text button carries
> `items-center justify-center`. The header right group is back to the original
> `gap-1` + `ml-2` spacing, and the Stop icon is a white filled square again.
> 0.7.2 briefly used a green Start and red Stop button at the user's request;
> 0.7.9 reverts Start to the original's neutral `fg-base` (Stop keeps the
> unambiguous `#c5403c` red in both themes).
>
> 0.7.9 restores the original's auto-sync rainbow ring: NSH has no
> pseudo-elements or `@keyframes`, so the `conic-gradient` ring is two real
> views (an oversized spinning layer clipped by the button's `overflow: hidden`
> + an inset card-colored cover), driven by one module-level `createMotion`
> rotate loop (2 s, linear, infinite) shared with the refresh icon; the active
> state adds the original's blue `boxShadow` glow, idle keeps `opacity 0.55`.
>
> 0.7.9 makes the feature boundary explicit. With no Kugou platform (or the
> NetEase placeholder) the app is **listener-only**: 直播间配置 / 点歌规则 /
> 点歌列表 / 黑名单 and the 已点歌单 tab (with its history) stay, but the
> Kugou 歌单 block, 手动点歌 input, row ListPlus, song-match subtitle and the
> right-click "复制歌名" item are hidden. A bordered 仅弹幕监听 panel replaces
> the manual-add block and says where to enable a platform. The original three
> tabs and rule fields are kept (hiding them would change the original layout);
> cooldown / per-user-limit / singer-blacklist hints now say explicitly that
> they only take effect once a platform is enabled, so listener-only mode makes
> no false promise about collection-side rate limiting. `addManual()` has a
> defensive guard, and `check_icon_buttons.py` checks the panel and the gate
> are branches of the same `<If>`. Tests cover all three platform states.
>
> 0.7.9 also removes the separate `启用酷狗服务` master switch. The plugin
> picker is now the only switch: one platform may be selected (`酷狗音乐` or
> the `网易云音乐` placeholder), or **none**. Switching away / turning all
> platforms off turns `auto_sync` off and hides every playlist/song-related
> piece (sidebar 歌单 block, row ListPlus, search subtitle, Kugou status
> line); the `酷狗登录` block is shown only for Kugou. A v2 config
> with `kugou_enabled:false` migrates to an empty `active_plugin`.
>
> 0.7.9 also narrows the Settings plugin tab to what the user asked for: only
> the plugin picker/enable switch and platform login. The `目标歌单` list,
> `设为目标`, the duplicate auto-sync switch and `搜索并加入` were removed —
> they were pieces of the original's separate KuGou API debug panel, not its
> settings. Turning 自动同步 ON now runs the original's `using exist or
> create` (`resolvePlaylistByName`: find the editable name in `get_all_list`
> pagesize=100, else create, write the resulting listid, then enable sync);
> a failed resolve leaves sync off. Tests cover both branches and the failure.
>
> 0.7.9 hardens the above: `get_all_list` fails closed on `status`/`error_code`
> (so a token failure cannot be mistaken for an empty playlist and create one),
> `kg-*` headers match kugou-api, playlist operations share a mutex+generation
> (double press / 清理 interleaving cannot build duplicate playlists or point
> sync at a deleted id), editing the name while sync is on turns sync off, and
> the real-renderer suite presses `id:auto-sync`. A static guard now fails CI
> if the settings debug blocks or the resolve call come back.
>
> 0.7.9 restores the sidebar's `清理` button (red outline + Trash2) next to
> `自动同步`, removing the self-invented `管理酷狗` entry point. `清理` now
> really deletes and recreates the playlist, in the original's order: delete
> the same-name playlist FIRST, then create a new one and return its new
> listid (which becomes `target_playlist_id`); a test asserts the request
> order. `playlistOps.ts` calls `add_list` (plain android JSON) and
> `delete_list` (the AES-CBC + RSAES-PKCS1-V1_5 protocol in
> `playlistCrypto.ts`). Encodings are checked against Node's own crypto by
> `scripts/kat-playlist.test.ts` / `kat-playlist.mjs`; no live account was
> used. Only a same-name (and same-id) playlist is deleted (a stale id is
> never trusted); writes are gated by zeroing `target_playlist_id` and stopping
> the worker before the delete, then restoring the new id afterwards. A failed
> lookup or a definite delete failure restores the old id; an unreadable
> delete answer or a create failure after a successful delete leaves the id at
> 0 so nothing writes into a deleted playlist.
>
> 0.7.9 also restores the original's inline row actions: 0.7.1's toolbar is
> removed and the queue rows carry ListPlus (add to playlist, pending spinner,
> disabled without login/target/track), Copy and Trash again, the played list
> its Copy — as plain views, not `DataTable` cells (0.7.1's finding stands:
> presses inside DataTable cells never reach `onPress` on a real renderer, and
> keyed rows are not re-rendered when an item changes). Add-to-playlist is one
> transaction again: `addTrack` succeeds and only then does the row move, and
> the "标记已点" button is gone (0.6.x's split of that transaction was wrong).
> The song cell carries the original's right-click menu via
> `onContextMenu` + `Menu.popup`, and selection-by-index is gone — deletes and
> adds are keyed by `msg_id`, never by row index (new songs are prepended, so
> a stale index silently pointed at another row).
>
> 0.7.1 also moves row actions out of `DataTable.renderCell` into a toolbar:
> NSH does not deliver presses to buttons inside a rendered cell on a real
> renderer, so copy/mark/delete had been silent no-ops there even though
> headless tests passed. Superseded in 0.7.9 by the view-based row lists.
>
> 0.7.1 fixes the silent clipboard and row-action buttons: `capabilities.clipboard` was missing, so
> every copy button rejected with ERR_ACCESS_DENIED and the log claimed success
> before the promise settled. All write calls now go through `copyText()` with
> await/catch, a shared footer status line gives visible feedback, clear-list
> asks for a second press, and `actions.test.tsx` asserts clipboard contents,
> row disappearance, log honesty and every previously silent button.
>
> 0.7.0 merges the Settings dialog and the About dialog into one modal with
> three underline tabs (general / plugin / about). The header info button opens
> Settings directly on the about tab; "管理酷狗" opened it on the plugin tab
> (0.7.0 wording — that sidebar button was removed in 0.7.9; the header
> settings icon still reaches the plugin tab).
> 0.6.3 matches the original's visible 30x30 start/stop box (its shadcn base
> class has a 1px transparent border) and its 6px radius. Two headless
> geometry tests plus a source guard (also on the Linux PR gate) protect it.
> Measured comparison, size table and open questions: `docs/PARITY-SIZES.md`.
>
> 0.6.0 adds the missing background half of Kugou: an eager per-song search
> cache, singer blacklist entries, a `SyncLedger`-based auto-sync worker with
> idempotent writes and auth-failure shutdown, the `kugou_enabled` gate, an
> About dialog with `nsh/updater` check, and the footer elapsed-time stat.
> Icons are now plain function calls so SVG colors follow theme switches.
> Still missing: token refresh, `/user/listen` version bias, playlist
> clear/recreate, user detail, and real-device QR confirmation.

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
  (green), UI shell + parity (green), auto-sync worker with stubbed Kugou
  (green), portable extract/launch (green). Live Douyin handshake, QR login
  and Kugou search API are non-blocking. Still to check: live chat frames/protobuf on a
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

## P3 — Kugou polish, susu + plugin host (1–2 weeks)

- `feat/susu`: branding, default room `767116735823`, kugou enabled by default.
- Kugou: token persistence, login QR, search, playlist picker, add to playlist,
  optional auto-sync on mark-played are in `Board.tsx` (`0.3.0`). Still missing:
  token refresh, user info, history/listen bias, playlist clear/recreate,
  in-app QR confirmation beyond status polling.
- Plugin host: NSH hidden AppView + host.send/host.call RPC, manifest, install,
  per-plugin storage/permissions. Until then, Kugou is a directly imported
  module (`plugins/kugou/`), not an isolated plugin.

## 0.8.x own SQLite schema + updates

> 0.8.0 replaces the `nsh_kv` bridge with the app's own database. The main
> store is `${process.dataDir}/sususongboard.db` (the same file the Tauri app
> used) with tables `config` (one row, typed columns + `extra` JSON for
> unknown keys), `blacklist` (one row per entry, with `created_at`),
> `kugou_session`, `settings` (theme, markers, leftovers) and `meta`
> (`schema`, import source/time); `PRAGMA user_version` tracks the schema.
> `board.config` stays one JSON document to TSX, so nothing in `Board.tsx`
> changed shape.
>
> Import is one shot: snapshot the old file with SQLite's backup API (WAL
> pages included, into `sqlite-backups/`), build the new database beside it,
> verify the room id and blacklist row count against the source, swap it in,
> then delete the old file. An unreadable legacy file is renamed
> `.unreadable-<time>` instead. `storage.json` is never read or written again.
>
> 0.8.0 also adds the in-app updater (设置 → 关于 → 检查更新): `nsh.json`
> names the repository and manifest key, `NSH Release` publishes signed
> `latest.json` plus macOS arm64/Intel and Windows archives on a
> `v<version>` tag, and the download checks signature, app id, version,
> size and SHA-256 before swapping the app and restarting.
>
> 0.8.1 fixes the start button: `token()` keeps the appearance the app
> started in and `If`'s `else` element is built once, so the play icon
> stayed dark on the dark button in light mode. It now reads the palette per
> scheme and start/stop are two `If`s. The same release drops the header's
> About icon (the tab remains), removes the manual 导入原版数据 picker
> (the first launch imports by itself), moves the sidebar version from a
> fixed footer into the scroll content, replaces the bottom-line `flash`
> text with `nsh/base` toasts (bottom-right, tone dot, swipeable, 3.2 s /
> 6 s for errors), and gives 点歌指令模板's ⓘ the placeholder tooltip
> (`[song]`/`[歌曲]`, `[space]`/`[空格]`, both examples).

> 0.8.5 hides the log panel behind a switch instead of always showing it:
> 设置 → 常规 → 显示日志面板 (default 已隐藏). The choice is stored as
> `board.log_visible` ("1"/"0") in SQLite's `settings` table, so it survives
> a restart; the bar (复制 / 清空 / 展开) only renders when it is on and the
> log has lines.

> 0.8.6 draws the blacklist type badge as a wrapper `View` (「歌曲」/「歌手」
> used to clip their second glyph when the background sat on the `Text`),
> and 0.8.7 restores the room preview the Tauri build had: a valid 抖音直播间
> ID fetches `live.douyin.com/<id>` after a 600 ms debounce and shows the
> streamer's nickname with a live dot (green for `status: 2`, grey otherwise,
> title as tooltip) — no 开始 press needed. 开始 re-parses the same page.

> 0.43.0-preview.1 renumbers the app away from the NSH branch's own `0.8.x`
> line: the Tauri mainline is at `0.42.1`, so the native rewrite previews the
> next minor as `0.43.0-preview.<n>` (`0.8.x` and `0.8.7` below are the same
> code, released before the rename). The updater compares semver, so
> `0.43.0-preview.1 > 0.8.7`; it never downgrades, so the jump is one-way for
> an installed app. `build` now feeds NSIS's four-number
> `VIProductVersion` fourth field, and `check_versions.py` runs in the release
> workflow and fails on stale version strings, not just missing ones.

> 0.43.0-preview.2 publishes the Windows one-file exe. `nsh package --target
> windows` only makes a directory (and the zip the updater replaces it from),
> so the single-file `SUSUSongBoard-Portable-<version>.exe` is the NSIS build of
> that directory: 0.43.0-preview.1 attached only the zip, which is why Windows
> had no portable download. `NSH Release` now builds the portable exe and the
> installer on the Windows runner and attaches both, as `nsh-windows.yml`
> already did for its own artifacts. `makensis` cannot run on macOS
> (Homebrew 3.13 aborts with `std::bad_alloc`), so this path is Windows-only.

> 0.43.0-preview.3 adds a plugin channel next to the built-in platforms.
> A plugin is a folder in `${dataDir}/plugins/<id>/` (`plugin.json` + one JS
> module) that the app runs in a **hidden WebView**: the only way an NSH app
> may run code it did not compile (the main VM deletes `eval`, refuses
> `.nshc` it did not build, and bundles everything at build time). The
> bridge is `window.nsh.postMessage` / `injectJavaScript`, with the plugin
> seeing `app.call(method, params)` (log, its own storage, and the app's
> `fetch` so capabilities still apply) and `plugin.define({...})` for what
> the app calls. Measured before building it: a `display: none` web view
> still loads and runs its page with timers at full rate (15 ticks in 4 s at
> 250 ms against 14 visible), and a two-call JSON round trip answers both
> ways. The built-in KuGou platform stays compiled in and does not use this;
> `plugin.test.tsx --target macos` installs, enables, calls, and removes the
> bundled demo plugin through the real filesystem and a real web view.

> 0.43.0-preview.4 keeps a plugin the app cannot run visible. Plugins live
> in `${dataDir}/plugins/` — outside the app bundle — so an app update leaves
> them in place; a plugin written for a newer bridge than the app now speaks
> used to be skipped while reading the folder, which made it look deleted. It
> stays in the list, says `需要 api N，当前应用支持 api M；该插件不加载，文件夹保留`,
> and its buttons do nothing but report that. A plugin written for an older
> bridge keeps running unchanged (`api` is only an upper bound).

> 0.43.0-preview.5 ships KuGou as a plugin: `plugins/kugou-web/index.js` is
> the built-in platform's API (search, QR login, playlists, add, resolve,
> clear) rewritten as one plain-JS module and embedded at build time
> (`scripts/embed-plugin.mjs`), so 设置 → 插件 can install it with no network.
> A plugin page gets a WebKit page's globals only: Node's `crypto` and
> `Buffer` are gone, so MD5 is implemented in JS and AES-128-CBC by hand
> (WebKit gives a plain page no `crypto.subtle`, it needs a secure context),
> and its HTTP goes through `app.call("http.json")` — the app's own network,
> so CORS never applies and `network.hosts` still decides what is reachable.
> The port is checked number by number: `scripts/kat-kugou-plugin.test.tsx`
> runs the plugin's `selftest` in a real WebView and
> `scripts/kat-kugou-plugin.mjs` compares MD5, the signed-params key, an
> AES-CBC vector and a 1024-bit RSA block against Node's crypto.
> The built-in KuGou platform stays compiled in and unchanged.

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
