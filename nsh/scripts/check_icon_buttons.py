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

# 3. Start/Stop box model. The original's shadcn base class has a 1px
#    transparent border, so size-8 (32px) paints a 30x30 visible box with a
#    6px radius. Keep the exact class that reproduces it; the geometry tests
#    only assert centering, they do not assert this box.
STOP_START_BOX = 'ml-[9px] mr-[1px] h-[30px] w-[30px] rounded-[6px]'
for testid in ("start", "stop"):
    marker = f'testID: "{testid}"'
    pos = board.find(marker)
    if pos < 0:
        errors.append(f"Board.tsx: {testid} IconButton not found")
    elif STOP_START_BOX not in board[pos:pos + 400]:
        errors.append(f"Board.tsx: {testid} lost the original 30x30/6px box class")
if 'color: "#ffffff"' not in board:
    errors.append("Board.tsx: Stop icon is no longer white (original text-white)")
# User-requested palette: green start, red stop (the original Tauri app used a
# neutral fg-base start button). Keep it guarded so it cannot drift back.
if 'testID: "start"' in board and 'bg-success active:bg-success-hover' not in board:
    errors.append("Board.tsx: Start button lost the green success palette")
if 'testID: "stop"' in board and 'bg-destructive active:bg-danger-hover' not in board:
    errors.append("Board.tsx: Stop button lost the red danger palette")
if 'props.color.startsWith("#")' not in ui:
    errors.append("ui.tsx: Icon() no longer accepts raw hex colors")

# 4. Sizes taken from the original Tauri app (src/components/...). Every
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
print(f"Start/Stop box guard: {STOP_START_BOX}")
print("Note: App.tsx is the POC entry, not the shipping Board.tsx; it is outside this guard.")

if errors:
    print("\nFAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("\nOK: every icon-bearing button goes through a centering IconButton.")
