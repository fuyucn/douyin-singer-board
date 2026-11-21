# Acceptance Status — 2026-11-20

## Candidate

- Branch: feat/align-main, based on 85e7ab6a44d2480aed354af90d2ef539477c76c8, with uncommitted repair/test/documentation changes.
- Product version: 0.43.1. The product version was not bumped.
- Runtime dependency: NSGo 0.2.0. No Tauri/NSH runtime was restored.
- Reference authorities and the two mandatory gates remain defined in [ACCEPTANCE.md](ACCEPTANCE.md).

## Gate Result

| Gate | Status | Reason |
|---|---|---|
| Functional | NOT RUN | Required offline and macOS native checks passed, but Windows native execution, authorized real-account checks, and end-to-end update installation remain unrun. |
| Visual | NOT RUN | Fresh macOS captures exist and sample screens were inspected, but pinned reference captures and complete human comparison are pending. Windows reference/candidate captures are also missing. |
| Overall | NOT ACCEPTED | Both mandatory gates have not passed. |

## Repairs and Reproduction

- A fresh macOS run of the original screenshot test passed with zero skips. The older .nsgo/native-validation.log was stale and did not describe the current run.
- The start action used the success/green fill instead of the main reference foreground fill. A new light/dark regression failed before the repair and passed after restoring the reference palette.
- Native pointer hover failed both for the workbench and a minimal tooltip primitive under NSGo 0.1.0. Both reproductions passed with NSGo 0.2.0 using an isolated temporary module manifest before updating the main dependency.
- Screenshot coverage now runs on both supported native desktop targets, with explicit light/dark desktop environments, 1000x680 desktop and 390x700 narrow layouts, pointer tooltip, and clear/recreate cancellation.
- The native acceptance command requires current-run JUnit results and screenshot files. Failed, skipped, empty, missing, or duplicated required test results cannot become PASS. Native checks do not automatically approve the Visual gate.
- A separate macOS/Windows acceptance-evidence workflow is added. It has not been pushed or executed remotely in this repair session and does not publish releases.

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
| Windows amd64 test-binary cross-compilation | PASS: seven packages compiled; not executed on Windows | .nsgo/acceptance/20261120/windows-compile.log and windows-build/ |

The start palette, light/dark workbench, clear confirmation, pointer tooltip, and narrow configuration were inspected locally. This limited inspection is not a complete pinned-baseline comparison and is not human Visual approval.

## Remaining Required Evidence

1. Run the native acceptance command on Windows itself and inspect its interactions and screenshots. Compilation is not native Windows acceptance.
2. Capture the pinned reference and candidate at matching OS, scale, viewport, theme, and state; complete the visual review matrix and record the human reviewer findings.
3. Complete separately authorized, user-operated live login and test-playlist checks on both music platforms, and verify a signed update install on the intended update channel without touching real playlists or another channel.
4. Tie the complete evidence set to the final candidate commit and obtain PASS for both gates before marking the migration accepted.
