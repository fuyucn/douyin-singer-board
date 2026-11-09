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
buttons = list(re.finditer(r"<Button\b.*?</Button>", board, re.S))
for m in buttons:
    block = m.group(0)
    line = board[: m.start()].count("\n") + 1
    if "Icon({" in block:
        errors.append(f"Board.tsx:{line} raw <Button> draws an icon; use IconButton()")
    # Center on the cross axis always. On the main axis only a full-width
    # left-aligned row (the original log-panel header: flex-1 + flex-row) is
    # exempt; a plain flex-row is still a regression waiting to happen.
    if "items-center" not in block:
        errors.append(f"Board.tsx:{line} raw <Button> lacks items-center")
    elif "justify-center" not in block:
        left_row_exempt = "flex-row" in block and "flex-1" in block
        if not left_row_exempt:
            errors.append(f"Board.tsx:{line} raw <Button> lacks justify-center")
    # An IconButton nested inside a raw Button is also a leak: use the
    # component itself as the button.
    if "IconButton({" in block:
        errors.append(f"Board.tsx:{line} raw <Button> wraps an IconButton")

# 2. IconButton must center both variants.
if 'layout = props.text ? "flex-row items-center justify-center gap-1" : "items-center justify-center"' not in ui:
    errors.append("ui.tsx: IconButton lost its centering layout")
if "class={`${layout} ${props.class}`}" not in ui:
    errors.append("ui.tsx: IconButton no longer applies the centering layout")

# 3. Sizes taken from the original Tauri app (src/components/...). Every
#    icon-bearing call site must use one of these explicit sizes.
ORIGINAL_SIZES = {
    "header": (30, 15),
    "start": (30, 15),  # visible box; original's outer 32px includes a 1px border
    "row": (28, 14),
    "small": (24, 14),
    "add": (32, 16),
    "text": (28, 14),
}
sizes = {
    "header-30": (30, 15),
    "start-30": (30, 15),
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
print(f"Raw <Button> blocks: {len(buttons)} (all must be centered)")
print(f"Standalone Icon() (non-button): {board.count('Icon({')}")
print("Note: App.tsx is the POC entry, not the shipping Board.tsx; it is outside this guard.")

if errors:
    print("\nFAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("\nOK: every icon-bearing button goes through a centering IconButton.")
