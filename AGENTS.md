# SongBoard Agent Instructions

Before changing SongBoard behavior, UI, packaging, or releases, read [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). It is the canonical acceptance standard.

Acceptance has exactly two mandatory gates:

1. **Functional** — required workflows pass with reviewed evidence.
2. **Visual** — the native UI matches the approved reference with reviewed evidence.

Both gates must be `PASS` before calling work accepted, complete, or release-ready. A `FAIL` or `NOT RUN` item in either gate means the result is `NOT ACCEPTED`. Tests are functional evidence; screenshots require human comparison and do not replace functional checks. Do not report acceptance based on only one gate.

Keep detailed checklists, pinned references, platform requirements, and the result template in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md); do not duplicate or weaken them here.
