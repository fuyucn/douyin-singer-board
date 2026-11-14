"""Measures what a real Windows renderer drew for win-input.test.tsx.

The entry (win-input-entry.tsx) lays a mirror text, the field (found by its
blue border) and a title line on white, at fixed positions. This script
asserts, on the PNGs the test left:

- the field's text drew INSIDE the field (no ink in the white ring around
  it - RichEdit at a broken scale paints its glyphs outside);
- the field's text is as tall as the mirror's (the same string in the
  engine's own text: the field's font matches the app's);
- selecting all filled a wide band inside the field (the native blue
  highlight), and filled nothing outside it.

Usage: python check_win_input.py --scale 1.5
  reads win-input-<scale>-value.png and win-input-<scale>-selected.png
  next to the current directory and exits 1 on the first broken rule.
"""

import argparse

from PIL import Image

BORDER = (37, 99, 235)  # #2563eb, the field's border class
INK_LUMA = 120  # foreground #191d24 and darker antialiasing
CHANNEL = 24  # a pixel changed if a channel moved at least this much


def near(px, want, tol):
    return all(abs(px[i] - want[i]) <= tol for i in range(3))


def luma(px):
    return 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]


def ink_bbox(img, rect):
    """The bounds of the dark pixels inside `rect`, or None."""
    left, top, right, bottom = rect
    xs, ys = [], []
    px = img.load()
    for y in range(max(top, 0), min(bottom, img.height)):
        for x in range(max(left, 0), min(right, img.width)):
            if luma(px[x, y]) < INK_LUMA:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1, len(xs))


def find_field(img):
    """The blue border's bounds, grown to the whole border rectangle."""
    px = img.load()
    xs, ys = [], []
    for y in range(0, img.height, 2):
        for x in range(0, img.width, 2):
            if near(px[x, y], BORDER, 60):
                xs.append(x)
                ys.append(y)
    if len(xs) < 40:
        raise SystemExit(f"FAIL: the field's blue border is not on screen ({len(xs)} px)")
    return (min(xs), min(ys), max(xs) + 2, max(ys) + 2)


def count_ink_outside(img, field, avoid, grow):
    """Dark pixels within `grow` of the field, outside it, minus `avoid`."""
    left, top, right, bottom = field
    outer = (left - grow, top - grow, right + grow, bottom + grow)
    px = img.load()
    count = 0
    for y in range(max(outer[1], 0), min(outer[3], img.height)):
        for x in range(max(outer[0], 0), min(outer[2], img.width)):
            inside = left <= x < right and top <= y < bottom
            if inside:
                continue
            if any(a[0] <= x < a[2] and a[1] <= y < a[3] for a in avoid):
                continue
            if luma(px[x, y]) < INK_LUMA:
                count += 1
    return count


def diff_bbox(was, now, rect, step):
    """The bounds and count of the pixels that changed inside `rect`."""
    a, b = was.load(), now.load()
    left, top, right, bottom = rect
    xs, ys, n = [], [], 0
    for y in range(max(top, 0), min(bottom, was.height), step):
        for x in range(max(left, 0), min(right, was.width), step):
            if any(abs(a[x, y][i] - b[x, y][i]) >= CHANNEL for i in range(3)):
                xs.append(x)
                ys.append(y)
                n += 1
    if not xs:
        return None
    return (min(xs), min(ys), max(xs) + step, max(ys) + step, n * step * step)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=1.0)
    args = ap.parse_args()
    s = args.scale
    failures = []

    value = Image.open(f"win-input-{args.scale}-value.png").convert("RGB")
    field = find_field(value)
    grow = round(14 * s)
    gap = round(24 * s)
    # The mirror sits one 24-point gap above the field, the title one below;
    # their ink bands leave the ring around the field empty by layout.
    mirror_band = (0, field[1] - gap - round(30 * s) - 4, value.width, field[1] - gap + 4)
    title_band = (0, field[3] + gap - 4, value.width, field[3] + gap + round(30 * s) + 4)

    mirror = ink_bbox(value, mirror_band)
    if mirror is None or mirror[4] < 200:
        failures.append(f"the mirror text is missing ({mirror and mirror[4]} ink px)")
    title = ink_bbox(value, title_band)
    if title is None or title[4] < 200:
        failures.append(f"the title text is missing ({title and title[4]} ink px)")

    inset = round(3 * s)
    inner = (field[0] + inset, field[1] + inset, field[2] - inset, field[3] - inset)
    text = ink_bbox(value, inner)
    if text is None or text[4] < 200:
        failures.append(f"the field's text is missing inside the field ({text and text[4]} ink px)")
    leaked = count_ink_outside(value, field, [mirror_band, title_band], grow)
    if leaked > 20:
        failures.append(f"{leaked} ink px drew outside the field (text escaped its box)")

    if text and mirror:
        ratio = (text[3] - text[1]) / (mirror[3] - mirror[1])
        if not 0.7 <= ratio <= 1.45:
            failures.append(
                f"the field's text is {ratio:.2f}x the mirror's height "
                f"({text[3] - text[1]} vs {mirror[3] - mirror[1]} px) - a different font"
            )
        print(f"field text {text[4]} px, bbox {text[2] - text[0]}x{text[3] - text[1]}, "
              f"mirror {mirror[4]} px, bbox {mirror[2] - mirror[0]}x{mirror[3] - mirror[1]}, ratio {ratio:.2f}")

    selected = Image.open(f"win-input-{args.scale}-selected.png").convert("RGB")
    step = 2 if s >= 1.25 else 1
    change = diff_bbox(value, selected, field, step)
    min_px = round(900 * s * s)
    min_w = round((field[2] - field[0]) * 0.3)
    if change is None or change[4] < min_px or change[2] - change[0] < min_w:
        failures.append(
            f"no visible selection fill inside the field "
            f"(changed {change and change[4]} px, need {min_px}; width {change and change[2] - change[0]}, need {min_w})"
        )
    else:
        leaked_sel = count_ink_outside(selected, field, [mirror_band, title_band], grow)
        if leaked_sel > 20:
            failures.append(f"{leaked_sel} ink px outside the field with the selection shown")
        print(f"selection fill {change[4]} px, bbox {change[2] - change[0]}x{change[3] - change[1]} inside the field")

    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        raise SystemExit(1)
    print(f"OK at scale {s}")


if __name__ == "__main__":
    main()
