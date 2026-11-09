"""Static parity guard for icon buttons.

NSH's <Button> is an unstyled host (column layout, top-left). The original
app's shadcn Button always centers its content. Every button that draws an
icon must therefore go through IconButton in ui.tsx; this guard stops a raw
<Button> + Icon() pair from ever coming back.

Run from the nsh/ directory: python scripts/check_icon_buttons.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
board = (ROOT / "Board.tsx").read_text(encoding="utf-8")
ui = (ROOT / "ui.tsx").read_text(encoding="utf-8")
errors = []

# 1. No raw <Button> may contain a direct Icon() call.
for m in re.finditer(r"<Button\b.*?</Button>", board, re.S):
    block = m.group(0)
    if "Icon({" in block:
        line = board[: m.start()].count("\n") + 1
        errors.append(f"Board.tsx:{line} raw <Button> draws an icon; use IconButton()")

# 2. IconButton must center both variants.
if 'layout = props.text ? "flex-row items-center justify-center gap-1" : "items-center justify-center"' not in ui:
    errors.append("ui.tsx: IconButton lost its centering layout")
if "class={`${layout} ${props.class}`}" not in ui:
    errors.append("ui.tsx: IconButton no longer applies the centering layout")

# 3. Sizes taken from the original Tauri app (src/components/...). Every
#    icon-bearing call site must use one of these explicit sizes.
ORIGINAL_SIZES = {
    "header": (30, 15),
    "start": (32, 15),
    "row": (28, 14),
    "small": (24, 14),
    "add": (32, 16),
    "text": (28, 14),
}
sizes = {
    "header-30": (30, 15),
    "start-32": (32, 15),
    "row-28": (28, 14),
    "small-24": (24, 14),
    "add-32": (32, 16),
}
entry = (ROOT / "geometry-entry.tsx").read_text(encoding="utf-8")
for key, (box, icon) in sizes.items():
    if f'geomKey: "{key}"' not in entry:
        errors.append(f"geometry-entry.tsx: missing size case {key}")

print("Original button sizes (points):")
for name, (box, icon) in ORIGINAL_SIZES.items():
    print(f"  {name:<8} button {box}x{box}  icon {icon}x{icon}")
print(f"IconButton call sites in Board.tsx: {board.count('IconButton({')}")
print(f"Raw <Button> blocks: {len(re.findall(r'<Button\b.*?</Button>', board, re.S))}")
print(f"Standalone Icon() (non-button): {board.count('Icon({')}")

if errors:
    print("\nFAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("\nOK: every icon-bearing button goes through a centering IconButton.")
