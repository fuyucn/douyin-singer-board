"""Guard the NSH release version across every file that names it.

The old repo's scripts/bump-patch.mjs only knows the Tauri app, so NSH versions
have to be kept in sync by hand. This check fails CI on the first drift —
both a missing new string and a stale old one: `nsh-windows.yml` names the
version three times and a single missed one only shows up as a failed smoke
step minutes later.

Run from the `nsh/` directory (or from the repo root; paths are relative to
this file): python nsh/scripts/check_versions.py
"""
import json
import re
import sys
from pathlib import Path

N = Path(__file__).resolve().parent.parent
ROOT = N.parent
version = json.loads((N / "nsh.json").read_text(encoding="utf-8"))
v = version["version"]
b = int(version["build"])
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

# `0.43.0-preview.1`: the preview suffix is a semver prerelease, which the
# updater compares correctly (0.43.0-preview.1 < 0.43.0, both > 0.42.1).
semver = re.fullmatch(
    r"(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.\-]+))?(?:\+[0-9A-Za-z.\-]+)?", v
)
if not semver:
    errors.append(f"nsh.json: version {v!r} is not MAJOR.MINOR.PATCH[-prerelease]")
    numeric = "0.0.0"
else:
    numeric = ".".join(semver.group(1, 2, 3))

# NSIS takes `VIProductVersion` as four plain numbers, each 0..65535, so the
# version string cannot go in as-is. The fourth field is `build`: it keeps
# rising across previews, where the version's own numbers do not.
if not 0 <= b <= 65535:
    errors.append(f"nsh.json: build {b} must be 0..65535 (VIProductVersion's fourth field)")
quad = f"{numeric}.{b}"


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


checks = [
    (N / "Board.tsx", f'const APP_VERSION = "{v}";'),
    (N / "parity.test.tsx", f"v{v}"),
    (N / "installer" / "installer.nsi", f'!define APP_VERSION "{v}"'),
    (N / "installer" / "portable.nsi", f'!define APP_VERSION "{v}"'),
    (N / "installer" / "portable.nsi", f'!define APP_BUILD "{b}"'),
    (N / "installer" / "portable.nsi", f'VIProductVersion "{quad}"'),
    (ROOT / ".github" / "workflows" / "nsh-windows.yml", f"SUSUSongBoard-Portable-{v}.exe"),
    (ROOT / ".github" / "workflows" / "nsh-windows.yml", f"SUSUSongBoard-Setup-{v}.exe"),
    (N / "README.md", f"SUSUSongBoard-Portable-{v}.exe"),
    (N / "README.md", f"SUSUSongBoard-Setup-{v}.exe"),
]
for path, needle in checks:
    if needle not in text(path):
        errors.append(f"{path.relative_to(ROOT)}: missing {needle!r}")

# Stale copies of the old version must not survive anywhere.
stale = [
    (N / "Board.tsx", r'APP_VERSION = "([^"]+)"', [v]),
    (N / "installer" / "installer.nsi", r'APP_VERSION "([^"]+)"', [v]),
    (N / "installer" / "portable.nsi", r'APP_VERSION "([^"]+)"', [v]),
    (N / "installer" / "portable.nsi", r'APP_BUILD "([^"]+)"', [str(b)]),
    (N / "installer" / "portable.nsi", r'VIProductVersion "([^"]+)"', [quad]),
    (
        ROOT / ".github" / "workflows" / "nsh-windows.yml",
        r"SUSUSongBoard-(?:Portable|Setup)-([0-9][0-9A-Za-z.\-]*)\.exe",
        [v],
    ),
    (N / "README.md", r"SUSUSongBoard-(?:Portable|Setup)-([0-9][0-9A-Za-z.\-]*)\.exe", [v]),
]
for path, pattern, allowed in stale:
    for found in set(re.findall(pattern, text(path))):
        if found not in allowed:
            errors.append(
                f"{path.relative_to(ROOT)}: {found!r} is not the current "
                f"{'/'.join(allowed)!r}"
            )

print(f"NSH version: {v} (build {b}, installer file version {quad})")
print(f"Checked {len(checks)} release references, app id and fs capability")
if errors:
    print("\nFAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("OK: all NSH version references agree.")
