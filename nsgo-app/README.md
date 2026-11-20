# SUSUSongBoard

This NSGo application is the only maintained implementation. It embeds the TSX workbench, with an icon toolbar, 288-point playlist and configuration sidebar, request/played/blacklist tabs, optional logs and a narrow layout below 720 points. Settings is a modal with General, Plugins and About tabs. `preview-ui/` is an NSGo design fixture, not a separate release target. See [PARITY.md](PARITY.md) for reference versions and acceptance gates.

## Music platforms

Two bundled modules provide the music-platform integration:

- **KuGou:** QR login, credential restoration/logout, search, authenticated playlists, target binding/resolution/creation, confirmed playlist recreation, adding requests, and automatic synchronization.
- **NetEase Cloud Music:** QR login with native authentication response cookies, optional in-app MUSIC_U cookie login, credential restoration/logout, search, account-owned playlists, and the same playlist operations. A QR refusal is reported rather than treated as successful authentication; cookie login remains available.

Each operation runs in a fresh Goja runtime on a background goroutine. HTTP callbacks execute synchronously on that goroutine; Goja drains the adapters' Promise chains before returning. Runtime values are never shared across goroutines. Device identifiers remain stable for the application session. No Node module loading, filesystem access, or unrestricted fetch is provided.

The Go HTTP host permits exact HTTPS endpoints/methods, rejects redirects, caps sizes, and enforces deadlines. Authentication cookies are exposed only for NetEase's QR confirmation endpoint. NetEase QR images are generated locally. Tokens/cookies and raw API responses never enter ordinary preferences, UI snapshots, or logs.

These are bundled music-platform modules, not a general-purpose third-party plugin installer. See platform/adapter/SOURCE.md for provenance and safety changes.

## Data and authorization

The application retains `com.sususongboard.nsgo` so the migration does not overwrite older application installations or their data.

- The app opens SQLite read/write. On first launch it prefers its own `sususongboard.db`, otherwise adopts the sibling `com.sususongboard.app/sususongboard.db` if present, or creates a fresh database. It remembers the selection rather than silently switching databases. `SUSUSONGBOARD_DB` selects an existing database on first use; combine it with a separate `SUSUSONGBOARD_SETTINGS_DIR` for isolated testing.
- Song request rules save automatically after a brief pause while editing; no save button is required. Rules, blacklist, selected platform, account-bound playlist bindings, log visibility, and unconfirmed-write records live in `nsgo_board_settings`. Before adding that table to an existing database, the app verifies an online backup (including committed WAL changes) under `sqlite-backups/`. It seeds from `board-settings-v1.json` when present, otherwise imports supported legacy rules and blacklist entries. It leaves the old JSON and legacy tables unchanged. Do not downgrade using the old JSON or pre-migration backup after syncing: neither contains newer unconfirmed-write records. Lifetime OS locks exclude concurrent NSGo writers, and a missing previously selected database, invalid settings, or a failed migration blocks saves and platform operations.
- Platform tokens/cookies go exclusively to the system credential service through go-keyring, under com.sususongboard.nsgo.music with a separate account per provider. Errors never fall back to plaintext settings or SQLite. macOS uses Keychain, Windows uses Credential Manager, and Linux requires Secret Service. Legacy credential rows are not automatically imported; sign in once inside the app.
- Requests and played history are session-only. Same-name requests already in either visible list are rejected for both chat and manual input. A played row requires a confirmed platform add and a still-present queued request; late success never revives a deleted/cleared row. Cooldowns and per-user quotas use successful additions rather than pending requests. Clearing displayed history does not reset enforcement; resetting the session does. Transient eager-search failures retry at most three times after 2/4/6 seconds, with provider changes cancelling retries and discarding old results.

Auto-sync starts off and requires explicit activation after login. Starting it resolves or creates the named playlist first. Eager matching uses the first platform result, with at most two background searches; the add button and auto-sync share this cache. The row menu offers alternative search, copying the original message and blacklisting matched songs/artists. Automatic adds obey success-count quotas and cooldowns; explicit row adds override quota/timing limits but not blacklists or unknown-write guards. Platform changes, logout, target-name changes, recreation, rejected adds and uncertain writes stop synchronization.

Before an add, the app persists a nonsecret write guard keyed by platform, account, playlist ID, and track identity. A timeout retains the guard across removal, re-addition, reset, and restart. It is never automatically replayed. The operator must check the platform and explicitly acknowledge that the track was not added before unlocking it through a two-step action.

Playlist recreation confirms the target name and ID, rechecks the binding, and deletes only that ID, never other same-name playlists. Failed/ambiguous recreation disables the binding until account/playlists are refreshed.

## Development and tests

From this directory:

    go tool nsgo dev
    go test ./... -skip '^TestLiveDouyinConnection$'
    go test -race ./... -skip '^TestLiveDouyinConnection$'
    go tool nsgo check
    go tool nsgo test -target macos -run '^TestWorkbenchNativeScreenshot$'
    go tool nsgo build -target macos_arm64
    go tool nsgo build -target windows_x64 -installers=false

Offline tests exercise real TSX/Go actions, both adapters, crypto known answers, request restrictions, fake credential failures, playlist confirmation, automatic scheduling, SQLite migration and restore, write failures, exclusive locking, and preservation of legacy table contents. They do not sign into or modify real music accounts. The separate live Douyin test uses a public room. Setting SONGBOARD_PUBLIC_SEARCH=1 explicitly enables the TestPublicPlatformSearch test for anonymous read-only queries; it does not authorize playlist changes.

The check command generates declarations under .nsgo for tsconfig.json. Native screenshots are saved under .nsgo/test/screenshots/macos. A successful build or running process is not evidence that the interface rendered.

## Release boundaries

Windows cross-building does not prove native input, credential storage behavior, or a live Windows listener. Windows runtime acceptance and user-controlled music-account verification remain separate requirements. Offline tests do not prove current compatibility with third-party live APIs.

Signed updater-enabled packages are built separately from ordinary and portable packages. See [Signed updates](UPDATES.md) for stable and preview signing, feed setup, first installation, and release acceptance.

The packages workflow builds on manual dispatch or matching v* tags and uploads artifacts; it does not automatically publish Releases. nsgo.yaml is the sole version source, shared by the UI and packager. node scripts/bump-patch.mjs increments the patch or edition counter, including preview.N for migration previews and susu.N for existing editions. Display and package names omit the runtime suffix while the internal ID stays separate. The workflow does not push commits, overwrite an installed application, or run real account/playlist operations.
