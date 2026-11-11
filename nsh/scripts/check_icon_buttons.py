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
# User-requested palette, reverted to the original in 0.7.3: neutral Start
# (fg-base), unambiguous red Stop. Keep it guarded so it cannot drift back.
# Locate the actual call sites, not a whole-file substring (which a stale
# comment could satisfy).
for testid, palette, label in (
    ('testID: "start"', 'bg-foreground active:bg-muted-foreground', 'neutral Start'),
    ('testID: "stop"', 'bg-[#c5403c] active:bg-danger-hover', 'red Stop'),
):
    pos = board.find(testid)
    if pos < 0:
        errors.append(f"Board.tsx: {label} button not found")
    elif palette not in board[pos:pos + 400]:
        errors.append(f"Board.tsx: {label} lost its palette ({palette})")
if 'props.color.startsWith("#")' not in ui:
    errors.append("ui.tsx: Icon() no longer accepts raw hex colors")

# 3b. Settings plugin tab invariants (0.7.5): only the plugin switch and
#    platform login, and auto-sync resolves the playlist before enabling.
for stale in ("目标歌单", "搜索并加入", "设为目标", "加入列表", "启用酷狗服务", "kugou-toggle"):
    if stale in board:
        errors.append(f"Board.tsx: Settings plugin tab still contains {stale!r}")
if "也可以都不开" not in board:
    errors.append("Board.tsx: platform selection no longer allows all platforms off")
if 'const pluginEnabled = () => config().active_plugin === "kugou";' not in board:
    errors.append("Board.tsx: platform gating no longer follows active_plugin alone")
# 0.7.7: listener-only mode. Without a Kugou platform the sidebar must show a
# clear mode panel instead of the manual-add input (which is Kugou-only).
if "仅弹幕监听" not in board:
    errors.append("Board.tsx: listener-only mode panel is missing")
# Structural: the mode panel and the manual-add block must be the two branches
# of the SAME platform-gated <If>, not just two strings somewhere in the file.
gate = board.find("If when={pluginEnabled()} else={")
if gate < 0:
    errors.append("Board.tsx: 手动点歌 is no longer gated on the Kugou platform")
else:
    region = board[gate:gate + 1800]
    if "仅弹幕监听" not in region or "手动点歌" not in region:
        errors.append("Board.tsx: platform <If> does not contain both the mode panel and 手动点歌")
if "resolvePlaylistByName" not in board:
    errors.append("Board.tsx: auto-sync no longer resolves the playlist (using exist or create)")
if "autoSyncBusy" not in board:
    errors.append("Board.tsx: playlist operations lost their mutual-exclusion guard")

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
