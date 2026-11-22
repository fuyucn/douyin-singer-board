# Agent Acceptance Standard

This is the canonical acceptance standard for the SongBoard NSGo migration. It applies to feature work, fixes, UI changes, packages, releases, and claims of completion. Read it before changing behavior or presentation.

## Completion rule

There are exactly two acceptance gates:

1. **Functional** — required workflows behave correctly and have reviewed evidence.
2. **Visual** — the rendered native UI matches the approved visual reference and has reviewed evidence.

Acceptance is the logical AND: **Functional PASS AND Visual PASS**. There is no averaging, compensating, or “mostly passed” result. If any required item is FAIL or NOT RUN, overall acceptance is **NOT ACCEPTED**. Do not mark work done, merge it as accepted, publish it as verified, or claim a release is ready while either gate is not PASS. State the exact blocker instead.

Tests, native interactions, screenshots, and human review are evidence inside these two gates, not substitute gates. Passing tests does not establish visual parity. Generating screenshots does not establish that anyone reviewed them. Cross-compilation does not establish native OS acceptance.

Use only these statuses: PASS, FAIL, NOT RUN. Every checklist starts as NOT RUN and changes to PASS only when the required evidence is linked and reviewed.

## Reference authority

Keep the references and their authority separate:

- **Visual authority:** the approved douyin-singer-board GitHub main UI baseline, version 0.42.1, pinned to tag commit cc1141226154dc47a775c61735fcd41e195833e3. The observed main head during initial acceptance-spec authoring was 4ab43c58d75b09ac683fb57dbb4f4de3301c25a1; do not silently replace the approved v0.42.1 visual baseline with a later main head. Capture the reference from the pinned tag, not memory or an unrelated local branch.
- **Behavior authority:** the susu workbench and platform behavior at NSH commit fc63698, as recorded in the migration contract.
- GitHub main decides visual hierarchy, layout, typography, styling, copy, and icons. NSH susu decides workflow behavior and platform semantics. When they differ, preserve the GitHub main presentation while implementing the NSH behavior within that presentation. Current NSGo security and data-integrity safeguards remain mandatory.
- Record the exact baseline commit/version for both references for every acceptance run. Do not silently follow a moving branch. To change the approved baseline, get approval, update nsgo-app/PARITY.md, capture and identify the new references, and record why.
- Marking a checklist row out of scope requires a written scope rationale and reviewer approval. Do not use “not applicable” to bypass a relevant OS, theme, workflow, or screenshot.

## Gate 1 — Functional

Functional is PASS only when every applicable row passes with reproducible evidence tied to the candidate commit.

| Area | Required result | Minimum evidence |
|---|---|---|
| Intake and admission | Chat and manual requests parse the configured template and share same-name deduplication across queue and played history. Fan level, blacklist, per-user success quota, and cooldown are enforced consistently. Recognized rejected requests log the actual reason. | Offline behavior tests plus visible rejection details in the app log. |
| Matching and queue | Search is eager and bounded. Transient retries and cancellation stay within policy; a stale provider result cannot replace a current result. A row moves to played only after confirmed remote success. Late responses cannot resurrect removed/cleared rows. | Matching, retry, cancellation, and late-result tests plus observed queue state. |
| Both platform plugins | Test NetEase and KuGou independently: enable/disable, QR and cookie login/cancel/error handling, account verification, owned-playlist refresh, song search, manual add, and auto-sync. Secrets never appear in files, SQLite, logs, or CI artifacts. | Named mock-service tests per provider, including service-call arguments and secret-persistence assertions. |
| Playlist input and binding | The current name input is authoritative. Only typing or explicitly selecting a playlist changes it. Sync checks for an exact matching playlist and creates only when absent. Add, sync, and clear use the current value and confirmed binding. Renaming invalidates the old binding and stops sync. | Edit the input immediately before each mock operation; assert the value is preserved and the mock receives that exact name and ID. |
| Clear and recreate | Cancel performs zero destructive calls. Confirm targets only the explicitly bound playlist ID and never other same-name lists. Busy work disables confirmation but leaves cancel enabled. The confirmation does not obscure the workbench. | Test cancel and confirm at actual visible native window coordinates. Verify zero versus one correct mock call. Selector/frame-only clicks do not prove hit testing. |
| Busy, errors, and toasts | Busy states remain visible without unnecessarily locking unrelated controls. Failure and uncertain outcomes are visible; uncertain writes are never replayed automatically. Toasts/log changes do not erase inputs, replay queue operations, or rebuild the page. | Failure, timeout, persisted-write-guard, layout-stability, and notification tests; observe state before/after. |
| Settings and persistence | Settings is a modal over the workbench with General, Plugins, and About. Persisted settings/database migration, session-only queue/history/logs, restart, and reset match the migration contract. | Settings, isolated SQLite migration, backup, restart, reset, lock, and rollback tests. |
| Update behavior, when claimed | The first updater-enabled installer contains the intended app identity, update key, feed, and native updater. A real native check offers the newer verified installer; accepting installs and relaunches into the expected version while retaining the intended test settings. Ordinary packages and the standalone Windows EXE are explicitly non-updating. | Inspect installer metadata/appcast and signatures, then observe install, relaunch, resulting version, and data persistence. An update offer alone is not an update pass. |
| Package and source identity | The manifest, visible version, binaries, filenames, and CI source SHA agree. Windows portable is a directly downloadable single EXE with a checksum, not a ZIP. Windows updater acceptance uses the NSIS installer, not the portable EXE. | CI run SHA matches its documented ref; inspect artifact names, embedded versions, and SHA-256. |

### Automated commands

From nsgo-app, with live/public-search opt-ins unset, run:

~~~sh
env -u SONGBOARD_PUBLIC_SEARCH go test ./... -count=2 -skip '^(TestLiveDouyinConnection|TestPublicPlatformSearch)$'
go tool nsgo check ./...
node --test scripts/bump-patch.test.mjs
go run ./scripts/native-acceptance
~~~

Run native acceptance on macOS and Windows themselves. The command selects the host OS, creates a fresh .nsgo/acceptance/<platform>-<run>/ evidence directory, and checks that every required native test passed without skips. It also checks that the current run produced valid-sized PNGs for both themes at desktop and narrow viewports. It never reuses .nsgo/native-validation.log or promotes screenshot generation to visual approval. The JSON result records the candidate commit, uncommitted file status, command, OS/architecture, timestamps, and the separate pending visual review.

GUI-sensitive coverage includes TestWorkbenchNativeScreenshot, TestWorkbenchNarrowLayoutAndPlatformSettings, TestStartControlUsesReferencePalette, TestWorkbenchPointerTooltip, and TestWorkbenchFixtureReleasesResources. The screenshot flow captures pointer tooltips, menus, clear/recreate cancellation, settings, QR login, played history, logs, and narrow configuration. Fixture ownership must be disposed on the actual application context before temporary database cleanup; the lifecycle check reacquires both locks and renames the closed database. Native screenshot evidence uses mocked services and is not proof of real accounts or live platform writes. Execute these tests on Windows itself before marking Windows interaction PASS. A Windows cross-build is not a Windows run. The acceptance-evidence workflow collects platform-specific artifacts for separate review; green CI alone does not pass the Visual gate.

Prepare sufficient desktop workspace on ephemeral CI runners before native captures. The macOS job hides the runner's Dock and checks its visible desktop size; it does not change the developer's desktop. Assert actual application content bounds after resize as well as PNG dimensions. Do not compensate for a constrained runner by changing required viewports, padding/cropping screenshots, or weakening size checks.

At minimum, retain these named behavior checks in the relevant test runs:

- TestBothPlatformsResolveNamedPlaylistBeforeAutomaticAdd, TestBothPlatformSearchBindAddAndRestoreUI, and TestBothPlatformQRLoginAndCancellation.
- TestAutoSyncUsesPlaylistNameEditedImmediatelyBeforePress, TestClearPlaylistRequiresConfirmationAndStopsSync, and TestUnknownAddOutcomeCannotBeAutomaticallyRetried.
- TestRequestRejectionReasonsAppearInLogs, TestWorkbenchNotificationsDoNotMoveTheTableOrReplay, and TestTableIconTooltip.
- SQLite migration/backup/locking tests in preferences_test.go, plus TestUpdateCheckInAbout when an updater is part of the change.

A test name alone is not evidence: report which commands ran, their result, target OS, and tested commit. If a required behavior has no test, add a focused test where practical and record the manual observation; do not infer PASS from neighboring coverage.

### Functional safety boundaries

- Automated tests use fixture databases, mocked credentials, and fake platform clients. Never clear or recreate a real user playlist as an acceptance test.
- Real-account verification, when required by the claim, is a separately authorized user-operated test against a dedicated test playlist. Mock tests cannot prove real login, remote mutation, or current third-party service compatibility.
- Update-test builds must use an isolated app identity, settings/SQLite path, credential service, appcast, and test key. They must never alter the production update feed or trust an undisclosed disposable key as a permanent release key.
- If a native OS run, real-account check, or update install was unavailable, mark it NOT RUN. Another OS, a mock, and a compile do not substitute.

## Gate 2 — Visual

Visual is PASS only after a human reviewer compares rendered candidate screenshots with pinned reference captures on each required native platform. Source review, DOM/test selectors, screenshots without review, or a successful build cannot pass this gate.

### Capture protocol

For each candidate, record: candidate commit and app version; visual-reference commit/version; behavior-reference commit; OS and version; display scale; viewport; theme; deterministic sample state; screenshot paths; reviewer and findings. Capture reference and candidate at the same scale, viewport, theme, and state. Preserve source screenshots alongside candidate screenshots in CI artifacts or the acceptance record. Do not replace the approved reference with a mockup or a newly invented layout.

Capture the actual native app on both macOS and Windows at the supported desktop viewport, normally 1000×680, in light and dark themes. Also verify the responsive 390×700 narrow layout where that viewport is supported. Native title bars, window shadows, and system text rasterization may differ; compare the app surface and interaction geometry, not OS chrome pixel-for-pixel.

### Required screenshot states

Review each applicable state against the pinned visual baseline on each required OS/theme:

| State | Inspect |
|---|---|
| Empty and active workbench | Header, start/stop, connection status, sidebar width/order, tab bar, table columns and rows, counts, footer, empty state. |
| Queue and played | Row density, typography, status, hover/focus, context action, icon-only actions, tooltips, counts. |
| Playlist and sync | Name field, chosen binding, playlist chooser, inactive/active auto-sync appearance, refresh and clear controls. |
| Settings | Modal placement and size; General, Plugins, and About hierarchy; account/QR states; close interaction. |
| Toast and logs | Transient bottom-right toast; no layout banner or table shift; rejection reason legible in log. |
| Context menu and tooltip | Position, icon alignment, readable labels, dismissal, clipping, and menu action hit targets. |
| Destructive confirmation | Target name/ID, transparent background, visible cancel/confirm placement, busy/cancel state; visible button bounds equal actual native hit regions. |
| Narrow workbench | Configuration collapse/expand, reachable queue and settings, no clipped critical action or horizontal scrolling. |

### Visual pass criteria

- Preserve the pinned GitHub main hierarchy, density, typography, spacing, icons, tone, colors, and table geometry, while placing NSH-only behavior inside that visual structure.
- Every visible control's native hit region matches its painted bounds. Physically test icon actions, settings, tooltips, playlist selection, cancel, and confirmation at visible coordinates; no render-frame/hit-frame offsets.
- No unrequested header buttons, notification banners, substitute settings pages, duplicate cards, blank replacement panes, missing tooltip icons, emoji substitutes, or fabricated account/service states.
- Toasts are transient and do not shift/recreate the workbench. Modal and confirmation layering match the reference. No flashes, black redraws, or deleted logs/rows during playlist operations or settings changes.
- Copy, contrast, focus, busy/disabled states, and glyphs remain readable and complete in both themes and both supported platforms. No clipping, overlap, ellipsis on critical actions, broken fonts, or ambiguous states.
- Differences in OS window decoration and text anti-aliasing are allowable only when documented. Differences in hierarchy, content, density, state, copy, icon treatment, control placement, hit targets, or clipping are not waived as platform styling.

Missing OS/theme/viewport/state evidence, an unreviewed comparison, or an unresolved material deviation is Visual FAIL. If a pinned reference cannot be obtained, mark Visual NOT RUN; do not invent a substitute baseline.

## Result record

Record Functional and Visual separately. Do not replace these results with a single “tests passed” statement.

| Gate | Status | Evidence |
|---|---|---|
| Functional | NOT RUN | Test logs/workflow URLs, candidate SHA, OS, manual observations, and every unrun row. |
| Visual | NOT RUN | Both reference SHAs, candidate SHA, OS×viewport×theme×state screenshot matrix, side-by-side review and reviewer findings. |
| Overall | NOT ACCEPTED | Set ACCEPTED only when Functional=PASS AND Visual=PASS. |

~~~text
Candidate: <commit SHA / app version>
Visual reference: <repository, commit SHA, version, screenshot artifact>
Behavior reference: <repository and commit SHA>
Functional: PASS | FAIL | NOT RUN
Functional evidence: <test run/log URLs and manual evidence; list NOT RUN rows>
Visual: PASS | FAIL | NOT RUN
Visual evidence: <OS × viewport × theme × state screenshot paths and reviewer findings>
Overall: ACCEPTED only if both gates PASS; otherwise NOT ACCEPTED
~~~

A green workflow does not prove screenshot review; a screenshot review does not prove behavior. Release notes must disclose any required platform or row still marked NOT RUN.
