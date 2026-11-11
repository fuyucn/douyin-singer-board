"""Guard the NSH release version across every file that names it.

The old repo's scripts/bump-patch.mjs only knows the Tauri app, so NSH versions
have to be kept in sync by hand. This check fails CI on the first drift.

Run from the nsh/ directory (or from the repo root; paths are relative to this
file): python nsh/scripts/check_versions.py
"""
import json
import re
import sys
from pathlib import Path

N = Path(__file__).resolve().parent.parent
ROOT = N.parent
version = json.loads((N / "nsh.json").read_text(encoding="utf-8"))
v = version["version"]
b = str(version["build"])
major, minor, patch = v.split(".")
errors = []

# The app id must stay aligned with the old Tauri data directory; otherwise
# the automatic SQLite bridge cannot find sususongboard.db.
if version.get("id") != "com.sususongboard.app":
    errors.append(f"nsh.json: id is {version.get('id')!r}, expected com.sususongboard.app")
fs_caps = version.get("capabilities", {}).get("fs", {})
read_roots = fs_caps.get("read", [])
write_roots = fs_caps.get("write", [])
if "${dataDir}" not in read_roots or "${homeDir}" not in read_roots:
    errors.append("nsh.json: capabilities.fs.read must include ${dataDir} and ${homeDir}")
if "${dataDir}" not in write_roots:
    errors.append("nsh.json: capabilities.fs.write must include ${dataDir}")


def has(path: Path, needle: str) -> bool:
    return needle in path.read_text(encoding="utf-8")


checks = [
    (N / "Board.tsx", f'const APP_VERSION = "{v}";'),
    (N / "parity.test.tsx", f"v{v} · NSH 原生版"),
    (N / "installer" / "installer.nsi", f'!define APP_VERSION "{v}"'),
    (N / "installer" / "portable.nsi", f'!define APP_VERSION "{v}"'),
    (N / "installer" / "portable.nsi", f'!define APP_BUILD "{b}"'),
    (N / "installer" / "portable.nsi", f'VIProductVersion "{v}.0"'),
    (ROOT / ".github" / "workflows" / "nsh-windows.yml", f"SUSUSongBoard-Portable-{v}.exe"),
    (ROOT / ".github" / "workflows" / "nsh-windows.yml", f"SUSUSongBoard-Setup-{v}.exe"),
    (N / "README.md", f"SUSUSongBoard-Portable-{v}.exe"),
]
for path, needle in checks:
    if not has(path, needle):
        errors.append(f"{path.relative_to(ROOT)}: missing {needle!r}")

# The desktop README is a delivery artifact, not in git: warn, do not fail.
print(f"NSH version: {v} (build {b})")
print(f"Checked {len(checks)} release references, app id and fs capability")
if errors:
    print("\nFAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("OK: all NSH version references agree.")
