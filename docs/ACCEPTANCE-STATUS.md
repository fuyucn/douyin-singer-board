# Acceptance Status — 2026-11-20

## Candidate

- Branch: feat/align-main. Initial repair commit 95c1485f8ea753e42912a4807434bed8d8e4016e was based on 85e7ab6a44d2480aed354af90d2ef539477c76c8.
- The follow-up candidate repairs native fixture ownership and prepares CI desktop workspace. CI result metadata identifies the exact tested revision.
- Product version: 0.43.2. The reviewed NSGo migration was merged into main before this release bump.
- Runtime dependency: NSGo 0.2.0. No Tauri/NSH runtime was restored.
- Reference authorities and the two mandatory gates remain defined in [ACCEPTANCE.md](ACCEPTANCE.md).

## Gate Result

| Gate | Status | Reason |
|---|---|---|
| Functional | NOT RUN | Final-candidate CI passed native checks on both macOS and Windows, but authorized real-account checks and end-to-end update installation remain pending. Earlier CI failures are recorded below for context. |
| Visual | NOT RUN | Final-candidate native captures exist on both macOS and Windows, but pinned reference captures and complete human comparison are pending. |
| Overall | NOT ACCEPTED | Both mandatory gates have not passed. |

## Final CI Evidence

- Application candidate: `3d682b5deb13d47b8cf1f8ecb18b412cd83fca3b` on `feat/align-main`.
- Acceptance run: `44868857818`, completed with conclusion `success`; both macOS and Windows jobs succeeded, including macOS viewport preparation and native screenshot checks.
- This CI result closes the environment and native-check failures for that candidate. It does not approve visual parity, real platform accounts, or signed update installation.

## Repairs and Reproduction

- A fresh macOS run of the original screenshot test passed with zero skips. The older .nsgo/native-validation.log was stale and did not describe the current run.
- The start action used the success/green fill instead of the main reference foreground fill. A new light/dark regression failed before the repair and passed after restoring the reference palette.
- Native pointer hover failed both for the workbench and a minimal tooltip primitive under NSGo 0.1.0. Both reproductions passed with NSGo 0.2.0 using an isolated temporary module manifest before updating the main dependency.
- Screenshot coverage now runs on both supported native desktop targets, with explicit light/dark desktop environments, 1000x680 desktop and 390x700 narrow layouts, pointer tooltip, and clear/recreate cancellation.
- The native acceptance command requires current-run JUnit results and screenshot files. Failed, skipped, empty, missing, or duplicated required test results cannot become PASS. Native checks do not automatically approve the Visual gate.
- A separate macOS/Windows acceptance-evidence workflow was published on the feature branch. It does not publish releases; the first remote native failures are recorded below.

## First CI Run and Follow-up

- Push-triggered run 44856232057 tested initial repair commit 95c1485. Offline functional tests, NSGo checks, and version-rule tests passed on both native runners.
- macOS native interaction tests all passed, but the image verifier correctly rejected a constrained 1000x656 capture instead of 1000x680. Narrow captures were also clamped to 656 pixels high. No screenshot tolerance was relaxed.
- Windows produced all interaction screenshots, but every native case failed temporary-directory cleanup because the actual application scope still held its SQLite file. These are failed tests, not passes inferred from screenshots.
- The fixture ownership regression reproduced the unreleased lock on native macOS before the fix and passed after deterministic disposal on the application context. It verifies both locks can be reacquired and the database can be renamed. This proves resource cleanup, not per-test native-window destruction; the test host owns the native process/window lifetime.
- The follow-up explicitly resizes and checks application content bounds before capture. Only the ephemeral macOS CI job changes Dock visibility and checks available desktop space. PNG dimensions and required states remain unchanged.
- Local follow-up offline tests passed twice, the race-enabled suite and NSGo type checks passed, and native checks passed 5/5 with zero skips, retaining 31 captures. Logs are under .nsgo/acceptance/github-44856232057/ and .nsgo/acceptance/macos-3843044310/ relative to nsgo-app. This records local evidence before the follow-up CI run; both OSes must be revalidated remotely and human visual approval is still separate.

## Latest Repair

- The song action surface is now the NSGo native context menu: a compact menu at the pointer, one command per row, and automatic dismissal after selection. The menu trigger keeps the flexible table column so the time and icon columns stay aligned; native tests assert that alignment. Alternative matching was kept as a secondary menu item that opens a dedicated search dialog.
- The native screenshot flow now presses both clear-confirmation buttons at their painted native coordinates and checks that cancel sends zero clear calls while confirm sends exactly one.
- The screenshot matrix adds the running header/stop control and active auto-sync glow states. The running state is driven by an isolated fixture controller; it does not open a live Douyin connection.
- The macOS CI viewport step now logs available display modes, selects a larger ephemeral-runner mode when one exists, hides the Dock and menu bar, and keeps the strict visible-frame and application-content checks.

The final candidate must carry a green acceptance workflow run on both native runners; the macOS viewport preparation failure is closed only by the remote runner result, not by a local pass. Local captures below remain development evidence and are not the authoritative final commit artifacts.

## Local Evidence

These paths are local development artifacts under ignored .nsgo, not published GitHub artifacts. They must accompany an acceptance review or be collected by CI; a source commit alone does not contain them.

| Check | Result | Path relative to nsgo-app |
|---|---|---|
| Offline Go suite, count=2, live/public search excluded | PASS | .nsgo/acceptance/20261120/offline-final.log |
| Race-enabled offline Go suite, live/public search excluded | PASS | .nsgo/acceptance/20261120/race-final.log |
| NSGo check, vet, generated types and TSX type check | PASS | .nsgo/acceptance/20261120/check-final.log |
| Version-rule tests | PASS | .nsgo/acceptance/20261120/version-final.log |
| Native macOS checks | PASS: 4 passed, 0 failed, 0 skipped | .nsgo/acceptance/macos-872331385/native.xml |
| Native candidate provenance | Recorded | .nsgo/acceptance/macos-872331385/result.json |
| macOS screenshots | 30 theme/state captures plus a pointer-tooltip capture | .nsgo/acceptance/macos-872331385/screenshots/ |
| Pre-commit native macOS checks | PASS: 5 passed, 0 failed, 0 skipped; not bound to final commit | .nsgo/acceptance/macos-3357607973/native.xml |
| Pre-commit macOS screenshot matrix | 35 captures, including running header and active sync | .nsgo/acceptance/macos-3357607973/screenshots/ |
| Windows amd64 test-binary cross-compilation | PASS: seven packages compiled; not executed on Windows | .nsgo/acceptance/20261120/windows-compile.log and windows-build/ |

The start palette, light/dark workbench, clear confirmation, pointer tooltip, and narrow configuration were inspected locally. This limited inspection is not a complete pinned-baseline comparison and is not human Visual approval.

## Remaining Required Evidence

1. Preserve and review the final-candidate CI artifacts from run 44868857818 so the macOS viewport preparation and Windows native evidence remain tied to application candidate 3d682b5.
2. Capture the pinned reference and candidate at matching OS, scale, viewport, theme, and state; complete the visual review matrix and record the human reviewer findings.
3. Complete separately authorized, user-operated live login and test-playlist checks on both music platforms, and verify a signed update install on the intended update channel without touching real playlists or another channel.
4. Tie the complete evidence set to the final candidate commit and obtain PASS for both gates before marking the migration accepted.
