# SongBoard Agent Instructions

Before changing SongBoard behavior, UI, packaging, or releases, read [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). It is the canonical acceptance standard.

Acceptance has exactly two mandatory gates:

1. **Functional** — required workflows pass with reviewed evidence.
2. **Visual** — the native UI matches the approved reference with reviewed evidence.

Both gates must be `PASS` before calling work accepted, complete, or release-ready. A `FAIL` or `NOT RUN` item in either gate means the result is `NOT ACCEPTED`. Tests are functional evidence; screenshots require human comparison and do not replace functional checks. Do not report acceptance based on only one gate.

Keep detailed checklists, pinned references, platform requirements, and the result template in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md); do not duplicate or weaken them here.

## Version and tag rules

The canonical version is `nsgo-app/nsgo.yaml`. Tags follow the manifest version exactly:

- Stable release: `vX.Y.Z`
- Preview release: `vX.Y.Z-preview.N`
- Special/susu release: `vX.Y.Z-susu.N`

Do not use a `nsgo-` prefix for package tags. A release must be built after the reviewed code is merged into `main`; bump the manifest on `main`, push it, run the package workflow from that commit, and tag that same commit. Delete obsolete or conflicting tags before creating the release tag. Asset names use the bare version without the `v` prefix, for example `sususongboard-0.43.2-windows-x64.exe`.
