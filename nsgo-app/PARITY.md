# Migration contract

NSGo is the sole maintained application. The previous implementations are historical references, not build targets or runtime dependencies.

## Separate authorities

- Visual structure: GitHub douyin-singer-board main (0.42.1, verified 2026-11-19). Keep its compact header, icon actions, 288-point sidebar, tabbed song table, optional logs and restrained light/dark palette.
- Functional behavior: NSH susu Board.tsx and the bundled kugou-web / netease-web adapters, captured from fc63698. Do not substitute a simplified platform-settings page for the workbench.
- Settings is a modal over the existing workbench, with General, Plugins and About tabs. Login and platform selection belong there. Playlist naming, clear/recreate and auto-sync belong in the sidebar.
- The header has theme, settings and start/stop only. Notifications are transient bottom-right toasts, not layout banners. The song table uses 48-point rows, compact icon actions with tooltips, and a song-name context action for the other commands.
- The blacklist uses a song/singer add bar and a four-column table. Unavailable artist and date metadata are shown as a dash; legacy timestamps are imported read-only, and new entries record their actual creation time. The log strip only appears when enabled and nonempty; the footer shows visible session counts and real connection/account status. Session reset is confirmed in General settings.
- Queue matching starts eagerly, with no more than two background searches. Transient search errors have at most three retries after 2/4/6 seconds; provider changes cancel pending retries and discard late results. ListPlus adds the cached first match; a row moves to played only after confirmed remote success, and deleted/cleared rows are never resurrected. Alternative search is secondary.
- Chat and manual requests share NSH's same-name deduplication against both queue and played history. Viewer admission also checks the successful per-user count. Remote success is still recorded for enforcement when its displayed request was removed during the write.
- The log shows why a recognized request was rejected, including the actual and required fan-club levels, blacklist matches, duplicates and the per-user quota. Normal chat is not labeled as a rejection.
- Starting auto-sync resolves or creates the named playlist first. Renaming it stops sync and invalidates the old binding. Clear/recreate only touches the confirmed bound ID, never other same-name playlists.
- Clear/recreate asks for confirmation without dimming the workbench. An in-flight addition shows progress on its queue row, not a warning in Settings. Automatic successes update history and logs without a toast per song; manual results and uncertain writes still notify.
- The per-user success quota and repeated-song cooldown apply to automatic adds. Explicit row adds can override those timing/quota limits, but never blacklists, unknown writes or credential verification.

## Identity and versioning

The display name, executable, bundle and package names are SUSUSongBoard, without a runtime suffix. The internal ID remains com.sususongboard.nsgo to preserve separate data and avoid overwriting legacy installs.

The canonical version is nsgo.yaml. Tags follow the manifest exactly: stable `vX.Y.Z`, preview `vX.Y.Z-preview.N`, and special/susu `vX.Y.Z-susu.N`. The migration preview started at 0.43.0-preview.1; 0.43.0 and 0.43.1 were regular packages, and 0.43.2 is the stable NSGo release after merging the migration into main. Run node scripts/bump-patch.mjs to increment only the patch or edition counter; for preview and susu editions, it increments the edition counter without changing the base version. Major/minor changes are explicit decisions. UI metadata and packaging read the same manifest. Release assets use the bare version without the `v` prefix. Signed stable, isolated update-test, and preview channels are separate; see UPDATES.md. They do not configure or replace the legacy auto-updater.

## Acceptance boundaries

Automated flows use mock music accounts and isolated settings/SQLite files. They are not evidence of real account authorization or actual remote playlist writes. NSGo saves to its own SQLite table after backing up an adopted database; the legacy tables remain untouched. Durable write guards and OS credential storage are retained even where older NSH behavior was less strict.

Windows compilation is not Windows interaction acceptance. Real authenticated QR/Cookie login, platform playlist mutations and Windows keyboard/runtime verification remain manual acceptance gates. Repository cleanup does not remove previously installed applications or their data.
