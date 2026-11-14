# SUSUSongBoard · NSH rewrite

NSH (Native Shell) rewrite of `douyin-singer-board`. Windows is the primary
target; macOS is the development target. The NSH app is the shipping
version (0.43.3); the Tauri app on `main` is not part of this branch.

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

## Plugin channel

Every platform is a plugin. A plugin is a folder in `${dataDir}/plugins/<id>/`:

```
plugin.json   { "id": "kugou-web", "name": "酷狗音乐", "version": "0.1.0", "api": 1, "entry": "index.js" }
index.js      plugin.define({ search: async ({keyword}) => [ … ] })
```

The app reads both, wraps the module in a page that gives it two globals
(`app.call(method, params)` for logging, its own storage and the app's `fetch`;
`plugin.define({...})` for what the app calls), and runs it in a hidden
WebView — the only way an NSH app can run code it did not compile (the main VM
has no `eval`, and bundles are compiled at build time). Every payload crosses
as a JSON string over `window.nsh.postMessage` / `injectJavaScript`.

Settings → 插件 lists them. 酷狗音乐 ships as a plugin (installed on first
run, installable again after 移除) and **启用 selects it as the platform**;
there is one platform at a time. Every row has 安装 / 启用·停用 / 移除
(安装 only while it is missing).

网易云音乐 is the second platform (`plugins/netease-web/`): search, playlists,
add/resolve/clear all go through the same bridge, using the weapi protocol
(AES twice + raw RSA) computed inside the plugin. Login scans a QR (the
plugin asks NetEase for a key and draws it with `api.qrserver.com`). TSX `fetch`
hides `Set-Cookie`, so the login check goes through the native crate's
`Net.fetchRaw` (Rust fetch, status + body + headers); on `803` the plugin keeps
`MUSIC_U`/`__csrf`, every later weapi call sends them, mutations add
`csrf_token`, and the cookie is stored as the session — a restart stays logged
in. 设置 → 插件 also accepts a pasted `MUSIC_U` as a fallback.

设置 → 插件 shows exactly these two cards. A plugin that did not ship with the
app can still be installed by putting its folder in `${dataDir}/plugins/<id>/`
at startup, but there is no user-facing list or rescan button: the app is a
two-platform player, and the generic list (rescan / call a demo method) is
only rendered for the plugin-channel tests via `host.params.pluginDebug`.
There is no bundled demo: `plugin.test.tsx` seeds the minimal plugin shape.

What this costs:

- A WebView is needed for every platform feature, so **Windows needs the
  WebView2 runtime** (Windows 11 has it; the row reports `onError` when it is
  missing). With it missing the app runs in listener-only mode.
- A plugin's page has a web engine's own network: `app.call("http.json")`
  goes through the app's `fetch` (so `network.hosts` applies); a bare `fetch`
  inside the page does not, and CORS blocks it anyway.
- `http.raw` (Rust fetch, status/body/Set-Cookie) is handed to
  plugin pages; it is only for keeping a login session, and any plugin folder
  can request allowlisted hosts with it.
- 网易云 draws its QR through `api.qrserver.com`; that host sees the login
  challenge and the IP. No other third-party host is used.

- `api: 1` is the bridge this app speaks. A plugin asking for a newer bridge
  stays in the list, labelled 不可用 with the reason and its folder kept — an
  update never makes a plugin look deleted — while an older `api` keeps
  running.
- Plugins live in the data directory, not in the app: an update replaces the
  app only, so installed plugins survive it (and so does their enabled state).
- The suites that need the platform (`board`, `parity`, `actions`,
  `sync-worker`, `kugou-ui`, `plugin*`) run with `--target`, because the
  headless runner has no WebView or filesystem.

## Windows artifacts

`nsh package --target windows` makes a directory (`SUSUSongBoard/`) plus the
zip the updater replaces it from. The one-file download is an NSIS build of
that directory, so both come from `installer/`:

- `SUSUSongBoard-Portable-0.43.3.exe` — one file, ~26 MB; first run extracts to
  `%LOCALAPPDATA%\Programs\SUSUSongBoard`, later runs launch directly. A
  registry build marker (`PortableBuild`) keeps an updated install from being
  overwritten by an older launcher.
- `SUSUSongBoard-Setup-0.43.3.exe` — per-user NSIS installer, same directory
  (`%LOCALAPPDATA%`, so `nsh/updater` can replace the app without elevation).
- `SUSUSongBoard-0.43.3-windows-x86_64.zip` — raw directory, and the
  archive the updater uses. Not a hand-download.

`nsh-windows.yml` builds and smoke-runs both exes on every push; `NSH Release`
builds the same two on the Windows runner and attaches them to the release
next to the updater archives.

`makensis` cannot build on macOS (Homebrew's 3.13 aborts with
`std::bad_alloc`), so these two exes are only ever built on a Windows runner.

## Listener-only mode (0.43.0-preview.6)

功能边界按「有没有启用酷狗平台」拆分，不改动原版左栏布局：

| | 仅弹幕监听（无平台） | 启用平台（酷狗或网易云） |
|---|---|---|
| 弹幕监听与点歌指令收集 | ✅ 始终工作 | ✅ |
| 直播间配置 / 点歌规则 / 点歌列表 / 黑名单 | ✅ 字段保留；两个限流字段仅在启用平台并同步时生效，歌手黑名单需平台匹配 | ✅ |
| 已点歌单 tab（保留历史记录） | ✅ 仅查看历史，无平台时不能新增 | ✅ |
| Kugou 歌单（名字 / 清理 / 自动同步） | ❌ | ✅（登录后） |
| 手动点歌输入框 | ❌ | ✅ |
| 行内 ListPlus / 歌曲匹配副标题 / 右键复制歌名 | ❌ | ✅ |

无平台时，原「手动点歌」位置显示一块带边框的 **仅弹幕监听** 说明面板：
点歌指令只进「点歌列表」，并提示「设置 → 插件 → 启用酷狗音乐」。
两个平台都未启用时显示同样的面板。三 tab、直播间配置、
点歌规则一律保留（用户曾多次要求不要擅自重排原版布局）；规则里两处只与
歌单相关的副标题，以及黑名单的歌手屏蔽说明，在无平台时都明确写成
「仅监听模式不启用 / 需启用平台后生效」，避免承诺不存在的限流能力。
`addManual()` 也有防御守卫，防止残留键盘提交在监听-only 模式注入歌曲。
`check_icon_buttons.py` 会检查说明面板与 `<If when={pluginEnabled()}>` 门控
是同一个条件分支，面板被删或门控被拆都会让 CI 红。

## SQLite main storage

The app id remains `com.sususongboard.app`. The main store is
`${process.dataDir}/sususongboard.db`, not `storage.json`. `process.dataDir`
is NSH's default per-app directory (system data directory + app id):

| Platform | File |
|---|---|
| macOS | `~/Library/Application Support/com.sususongboard.app/sususongboard.db` |
| Windows | `%APPDATA%\com.sususongboard.app\sususongboard.db` |
| Linux | `$XDG_DATA_HOME/com.sususongboard.app/sususongboard.db` (`~/.local/share` when unset) |
| Android | the app's files directory + the app id |

`native/` uses `rusqlite` through NSH's existing Rust class bridge
(`app/sqlite`), with the bundled SQLite C amalgamation on every target. That
keeps one SQLite version on macOS, Windows, Linux and Android, and never
picks up a Homebrew or distribution build at link time. No NSH fork is
needed.

The database is the app's own: `config` (one row), `blacklist` (one row per
entry, so it can be queried), `kugou_session` (one row), `settings` (theme,
migration markers, leftovers) and `meta` (`schema`, import source, import
time). `board.config` is still one JSON document to TSX; the store splits it
into those columns and keeps unknown keys in `config.extra`, so a new field
needs no schema migration. `PRAGMA user_version = 1` tracks the schema.

Before the first import, **quit the old Tauri app and leave it stopped**; it
ows the file until the import replaces it. The source order is:

1. `${dataDir}/sususongboard.db` (the old Tauri SQLite database),
2. `com.fuyucn.sususongboard/sususongboard.db` (historical app id),
3. current `storage.json`, then old NSH `com.sususongboard.nsh/storage.json`.

Import is one shot: the source is snapshotted with SQLite's backup API
(including WAL pages) into `${dataDir}/sqlite-backups/`, the new database is
built beside it, its room id and blacklist row count are verified against the
source, and only then does it take the file name. The old database is deleted
at that point — it is not opened again, and `storage.json` is neither read
nor written afterwards. `storage.json` itself is left on disk untouched; a
conflicting copy is also kept as `legacy.nshStorageBackup.*`. An unreadable
legacy file is renamed `sususongboard.db.unreadable-<time>` instead of being
deleted.

Schema creation, all keys and `sqliteMigrationDone` commit together; backup,
validation or transaction failures abort before anything replaces the old
file. Board does not persist defaults after a failed startup, and routine
persistence errors appear in the UI and logs instead of being silently
discarded.

What migrates: room id, 点歌指令模板, 点歌规则, 歌单名/id, 黑名单 (歌曲 +
歌手, 含添加时间), 平台选择, kugou token/userid/dfid. What does not: token
freshness (re-scan if expired), 歌单列表 (re-fetched on login), auto-sync
(defaults to off), 队列/已点/日志/history (session data).

The manual **导入原版数据** picker is gone: the first launch imports the old
database itself, so a second path could only duplicate or overwrite it. The
native store performs that import; the old Python JSON exporter is not the
main storage backend.

## Updates

The app updates itself from GitHub Releases through `gh-proxy.com`: `nsh.json`
`"updater.url"` is that proxy prefix plus the repository's
`releases/latest/download/latest.json`, because `github.com` is unreliable from
mainland China. The proxy only forwards: the manifest is still verified against
the embedded public key and the archive against its SHA-256 and size, so a
compromised proxy cannot install anything. 设置 → 关于 → 检查更新 reads
`latest.json` from `releases/latest/download/`, verifies its signature, the
app id and the version, then 下载并安装 streams the archive (SHA-256 checked),
swaps the running app and restarts. A failed download or a refused archive
leaves the installed version untouched.

Publishing is `NSH Release` on a `v<version>` tag: it builds the macOS arm64,
macOS Intel and Windows archives on their own runners, writes the signed
`latest.json` with the key in the `NSH_UPDATE_KEY` secret, and attaches the
archives plus `latest.json`/`latest.json.sig` to the release. Tag and
`nsh.json`'s version must match. The manifest signing key is
`nsh keys/update` (gitignored): `keys/update.secret` signs, `keys/update.pub`
is embedded in `nsh.json`. Losing it means releasing a new key with a new
manifest, so keep it backed up.

Only a TSX change could ship as an OTA package (`.nshpkg`), which is smaller
than the 24 MB app but cannot carry native Rust changes; this app ships the
full archive, which is the same flow the old Tauri build used.

Build prerequisites: NSH 0.4.0, Rust >= 1.97 and a native C compiler (Xcode
Command Line Tools on macOS; MSVC Build Tools on Windows) for the bundled
SQLite amalgamation. Run build commands from `nsh/`, not the repository
root: cargo discovers `nsh/.cargo/config.toml` by walking up from the current
directory, and a different cwd silently compiles with different flags into
the same `target/`. A Rust-backed app makes `nsh build`/`nsh test` compile
NSH's host crates from source the first time — about 1 minute here, seconds
after that. That config drops debug info and incremental state, which keeps
the shared `target/` around 2-4 GB instead of 13 GB. A pure-TSX app without
`native/` compiles nothing at all (sub-second builds), which is why the Rust
crate is the only build cost in this project.
NSH dependencies
are pinned to a Git revision in `native/Cargo.toml`; generated declarations
and custom test/platform hosts come from `nsh build`/`nsh test`. Keep
`native/Cargo.lock` checked in. `nsh package Board.tsx --target windows`
builds the app-specific Rust executable with the SQLite class registered.
Browser/WebAssembly builds are not covered by this native driver.

Verification:

```sh
cargo test --manifest-path native/Cargo.toml --locked
nsh build Board.tsx
nsh test sqlite-store.test.tsx
nsh test board.test.tsx --target macos
```

Headless engines have no app data directory and use per-instance in-memory
SQLite. Existing `open({ storage })` fixtures are read once as seeds. Real
renderer fixtures explicitly supply `host.params.sqliteTestSeed` through
`sqlite-test-options.ts` to opt into isolated in-memory SQLite too: their
virtual Storage seeds are not files. Normal launches have no such parameter.
Tests do not mirror SQLite writes back to NSH Storage.
Durability, WAL snapshots, one-shot migration, transactional rollback and
failure recovery are tested against temporary on-disk databases in Rust.

## Playlist clear (0.43.0-preview.6)

The sidebar now mirrors the original: `Kugou 歌单` has a name input + read-only
`id`, and two equal buttons — red `清理` (Trash2) and `自动同步` (rainbow ring
when active). The self-invented `管理酷狗` button is gone; plugin management
stays reachable through the header settings → 插件 tab.

`清理` = **先删除同名歌单，再按同名创建新歌单，返回新 listid**，顺序与
原版 `clearPlaylistByName` 一致（测试断言 `delete_list` 早于 `add_list`）。
新 id 会写进 `target_playlist_id`，界面右侧的 `id:` 随之更新；截图里是
29 → 42。NSH 没有 Node sidecar，所以歌单协议由插件
（`plugins/kugou-web/index.js`）自己算：`add_list` 走和 `add_song` 相同的
android 签名 JSON，`delete_list` 用插件内手写的 AES-CBC + RSAES-PKCS1-V1_5。
A network stub cannot validate an encrypted body or a binary encrypted
response, so `scripts/kat-kugou-plugin.test.tsx` emits deterministic values and
`scripts/kat-kugou-plugin.mjs` recomputes them from **hardcoded reference
constants** with Node's own crypto and SPKI parser (md5 / AES key+iv
derivation / AES-CBC / RSA modulus+exponent / PKCS#1 v1.5 padding). The NSH
random-PS branch is checked by exposing EM through a test exponent of 1, and
`parseDeleteResponse` is exercised with binary ciphertext, plain JSON and
base64 text. **This is a protocol KAT, not a live-account test.**
只删「名字与可编辑歌单名一致、且 id 也一致」的那个（绝不按 stale
`target_playlist_id` 删，避免改了名字就删错歌单）。点下清理时先把
`target_playlist_id` 临时置 0 并停掉后台同步——worker、行内 ListPlus、设置页
「加入歌单」全都读这个值，这样删除到切新 id 之间的窗口不会有人往已删歌单
写歌；成功后再写入新 id，worker 自动重绑。查询失败 → 不删不建并恢复旧 id；
删除明确失败 → 不创建、恢复旧 id；删除响应不可解析（服务端可能已删）或
删除成功但重建失败 → id 保持 0 并移除本地条目，界面提示状态未知/重建失败；
名字/id 不一致 → 只新建、不删并给出提示。`loadLists()` 不再用服务端列表
覆盖你改的名字。所有失败都在底部明确提示。

## Table actions

NSH's `DataTable` does not deliver presses to buttons drawn inside
`renderCell` on a real renderer (headless tests call `onPress` directly and
therefore looked green), and its keyed rows are not re-rendered when an item
object changes, so both tables are plain views now: a sticky header outside a
`Scroll`, one `View` row per song rendered with `songRows().map(...)` (read in
JSX, so cache changes re-render), with the original's inline actions restored
per row: ListPlus/Loader (add to playlist, pending spinner, disabled without
login/target/track), Copy and Trash for the queue, Copy for the played list.
Column widths mirror the original (`#40 / 用户120 / 点歌 grow / 时间72 /
actions110`; played `#40 / 时间80 / 用户110 / 点歌 grow / actions48`). The
song cell carries the original's right-click menu (copy danmu / copy track
name / delete / blacklist song or singer) via `onContextMenu` + `Menu.popup`.
The toolbar-with-selection hack is gone, and with it the row-selection
semantics (`selectedRow`/`pickedRow`); deletion and add-to-played are keyed by
`msg_id`, never by row index.
`table-actions-target.test.tsx` runs with `--target macos` locally to verify
presses, non-first-row actions and the context menu on a real renderer; CI
runs it headless.

Trade-off vs the original: the original virtualizes rows (TanStack
`useVirtualizer`); these lists render every row. Song queues in normal use are
tens of rows, so this is accepted for now.

## Current state

- Original layout: header (logo, status, theme toggle, settings, start/stop),
  left settings panel, 点歌 / 已点歌单 / 黑名单 tabs, song table, log, manual
  add; config persisted with `Storage`; light/dark/system appearance; colors use the original shadcn tokens from `theme.json`.
- Matcher: `[space]` / `[song]` templates, fans level, per-user cooldown,
  cancel, blacklist, per-user max.
- Played list: one Copy button per row (also in a right-click menu on the
  song cell, together with copy-danmu / delete / blacklist).
- 黑名单: song names and singer names (Kugou artist match), add/remove with
  timestamps; persisted in config with defaults for older configs.
- Eager Kugou search cache (two concurrent lookups) shows the found artist,
  pending/not-found/error state, and red blocked rows in the song table.
- Background auto-sync worker: one `SyncLedger` idempotency key per request,
  3–5 s cycle, exponential backoff, blacklist/cooldown/per-user-limit skips,
  auth-failure circuit breaker, and clean teardown on config/session changes.
  Manual "add to playlist" (the row's ListPlus button) shares the ledger with
  the worker so a song is never added twice; an in-flight write is waited out,
  never taken over.
- Footer elapsed-time stat; everything playlist/song-related follows the
  selected platform.
- One Settings modal with three underline tabs (0.7.2):
  `general` (appearance, read-only runtime info), `plugin` (**only** the
  platform picker and the selected platform's login — QR code, status,
  logout), and `about` (version, repository, `nsh/updater` check; no manifest
  yet). 0.43.0-preview.6 removes the separate `启用酷狗服务` master switch: the platform
  picker IS the switch. One platform may be selected, or **none at all**.
  Switching platforms or turning them all off disables auto-sync and hides
  the sidebar `Kugou 歌单` block, the row's ListPlus button, the search-result
  subtitle and the Kugou status line; selecting Kugou brings them back.
  A v2 config with `kugou_enabled:false` migrates to "no platform".
  A platform switch is a transaction boundary: it invalidates an in-flight
  playlist resolve (which can never re-enable auto-sync afterwards), stops QR
  polling, clears queued searches and disables auto-sync. Session restore is
  deferred until config load and skipped entirely with no platform selected,
  so a stale token cannot produce phantom warnings. Config migration is
  written back to Storage immediately (`configLoaded` is a signal).
  The 0.43.0-preview.6 cleanup also removes the `目标歌单` list, `设为目标`, the duplicate
  auto-sync switch and `搜索并加入` from the plugin tab: those came from the
  original's separate **KuGou API 调试面板** (an About dialog sub-entry), not
  from its settings. Playlist management lives in the left panel
  (name / 清理 / 自动同步) only.
  Token/userid are kept in SQLite (`kugou_session`), not in the repo. Icons are drawn as plain
  function calls so their SVG colors follow theme changes.
- Turning 自动同步 ON performs the original's `using exist or create`:
  `resolvePlaylistByName` looks up the editable name in the user's playlists
  (`get_all_list`, pagesize 100, matching the original), uses its listid if
  present, otherwise creates a fresh playlist and returns the new id; only
  after a successful resolve is `auto_sync` enabled. A failed resolve leaves
  it off with a visible message. `playlists()` no longer overwrites the
  edited name/id from the server list. 0.43.0-preview.6 hardens this path: `get_all_list`
  fails closed on an application-level `status`/`error_code` (a token failure
  must never look like "no playlists" and trigger a create), request headers
  match kugou-api's `kg-*` set, a shared mutex+generation prevents double
  presses and interleaving with 清理, and editing the name while sync is on
  turns sync off instead of silently writing into the old playlist.
  `--target macos` presses `id:auto-sync` to prove the View handler fires on a
  real renderer, and `check_icon_buttons.py` guards the settings invariants.
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
- The left panel shows only the active platform's playlist and auto-sync;
  management is in Settings. Platforms are plugins in
  `${dataDir}/plugins/<id>/`, installed on first run and upgraded with the app;
  KuGou and NetEase both run over the WebView bridge.
- Auto-update uses the GitHub Releases manifest described under Updates; the
  portable wrapper re-extracts its newer payload on launch.

See `docs/PARITY.md` for the Windows gate and P0–P3 plan.
