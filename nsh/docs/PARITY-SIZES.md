# Visual parity check — original Tauri/WebView vs NSH native

Measured on macOS with the original dev server (`pnpm dev`, Chrome headless at
900x700 and 880x560) and `nsh test ... --target macos` screenshots (2x retina).
Points are CSS/native points, not pixels.

## Why this document exists

The user reported three times that the UI did not line up. The first two fixes
only checked **colors and existence**; the third check measured **geometry** and
found the real cause: NSH's `<Button>` is an unstyled host that lays its children
out in a column from the top-left, while the original's shadcn `Button` is
`inline-flex items-center justify-center`. Every icon-only button had to supply
its own centering.

All icon-bearing buttons now go through `ui.tsx` `IconButton()`. Two guards keep
it that way:

- `geometry.test.tsx` — `onLayout` bounds of button + icon at five sizes;
  center delta must be <= 1pt. Runs headless, so it is in CI.
- `scripts/check_icon_buttons.py` — static guard: no raw `<Button>` in
  `Board.tsx` may contain `Icon({`, and `IconButton` must keep its centering
  layout.

## Icon centering (start button, dark theme)

| Build | dx | dy |
|---|---|---|
| Original | +1.0 | -0.5 |
| 0.6.0 (before) | **-7.75** | **-7.75** |
| 0.6.1 | +0.75 | 0.0 |

All four header icon buttons in 0.6.1: dx within -0.3..+0.3pt,
dy within -0.8..+0.8pt. The geometry harness reports 0.00..0.50pt at every size.

## Button size table (points)

| Slot | Original button | Original icon | NSH button | NSH icon |
|---|---|---|---|---|
| theme / about / kugou | 30x30 | 15x15 | 30x30 | 15x15 |
| start / stop | 32x32 | 15x15 | 32x32 | 15x15 |
| table row actions | 28x28 | 14x14 | 28x28 | 14x14 |
| played-search clear, log chevron | 24x24 | 12-14 | 24x24 | 14x14 |
| blacklist add | 32x32 | 16x16 | 32x32 | 16x16 |
| clear-list / log copy / log clear (icon + text) | h-28, gap-1 | 14x14 | h-28, gap-1 | 14x14 |

## Header right group

Original `AppHeader.tsx` wraps all right actions in one flex row with `gap-1`
(4pt); start/stop adds `ml-2` (8pt). 0.6.0 put the buttons directly in the
header, which uses `gap-3` (12pt), shifting them 8-24pt to the left.

Icon x centers at 900px wide:

| | theme | middle | about | start |
|---|---|---|---|---|
| Original, kugou disabled (2 icons) | 790.5 | — | 825.0 | 868 |
| Original, kugou enabled (3 icons) | 756.8 | 790.8 | 824.8 | 868 |
| 0.6.0 (3 icons, gap-3) | 732.8 | 774.8 | 816.8 | 868 |
| **0.6.1 (3 icons, gap-1)** | **756.8** | **790.8** | **824.8** | **868** |

0.6.1 matches the original's three-icon layout exactly. The only semantic
difference is the middle button: the original shows a Kugou login icon there
(when `kugouEnabled`), NSH shows a settings gear because the new requirement
puts plugin management inside Settings. This is an intentional deviation.

## Narrow window (880x560) OCR comparison

| Element | Original | 0.6.1 | delta |
|---|---|---|---|
| 直播间配置 | (13, 69) | (15, 71) | +2, +2 |
| 抖音直播间 ID | (13, 99) | (14, 102) | +1, +3 |
| room value | (25, 131) | (25.5, 132.5) | +0.5, +1.5 |
| 点歌指令模板 | (13, 167) | (15, 166) | +2, -1 |
| tabs x | 309 / 411 / 515 | 312 / 415.5 / 517.5 | +3 / +4.5 / +2.5 |
| tabs y | 65 | 64.5 | -0.5 |
| 点歌规则 | (13, 255) | (15, 255) | +2, 0 |
| 最低粉丝团等级 | (13, 283) | (15, 285) | +2, +2 |
| 点歌冷却 (秒) | (149, 285) | (149.5, 286) | +0.5, +1 |

No text overflow or clipping at the minimum window size. The sidebar scrolls,
as in the original.

## Remaining known differences (checked, not fixed)

These come from NSH's native layout defaults, not from missing classes:

- `flexShrink` defaults to 0 in NSH (CSS defaults to 1). Long song names and
  narrow layouts can overflow instead of shrinking. `min-w-0` / `truncate` are
  applied at the known sites; a full audit of every `flex-1` is still pending.
- A view with no `display` lays children out in a **column** and stretches them
  on the cross axis. Text buttons inside column parents can become full-width.
  All current text buttons sit in row parents; the geometry harness wraps its
  text case in a row to reproduce the real layout.
- `Image` defaults to `objectFit: "cover"`; logo and QR images are square so
  they are unaffected, but any non-square asset would be cropped.
- `DataTable` defaults to `rowHeight: 32` / header = row height. We pass 48/32
  explicitly, matching the original's 48px rows.
- `radius: 0.4rem` = 6.4pt rounds differently under native rasterization;
  expect +/-1pt corner differences.
- Windows Chinese font fallback and 100/125/150% DPI are **not** verified by
  macOS screenshots. Native CoreText/Direct2D text metrics cannot be
  pixel-identical to WebKit.

## Functional differences found in this check (not yet fixed)

Checked against `src/AboutModal.tsx`, `src/components/AppHeader.tsx`,
`src/components/BlacklistPanel.tsx` and `src/App.tsx`:

| Area | Original | NSH 0.6.1 | Status |
|---|---|---|---|
| Header middle button | Kugou login icon (when `kugou_enabled`) | Settings gear | Intentional: new requirement puts plugins in Settings |
| About modal | version, check update, telemetry toggle, show-logs toggle, Kugou feature toggle, skipped-version reset | version, repo, check update | Simplified; telemetry/log/Kugou switches not ported |
| Settings dialog | none (config in left panel) | appearance + platform plugin picker | Intentional new requirement |
| Log panel visibility | toggled from About | shown automatically once logs exist | Simplified |
| Blacklist | song + singer entries, right-click add from table | song + singer via input bar | Right-click add not ported |
| Kugou token | refresh via `/login/token`, `/user/listen` bias, playlist clear/recreate | QR login only | Previously documented gap |

## What "parity" can and cannot mean

The original is a Chromium CSS box model; NSH is a native flex/grid layout with
platform text rendering. **Pixel-identical is not achievable.** The accepted
bar is: every control's position and size within 1pt, row heights and spacing
matching, colors/theme matching, and an automated geometry test that fails when
any icon button regresses. If exact WebKit rendering is required, the only
option is to host the original React frontend in an NSH WebView, which gives up
the native-rendering size win and needs WebView2 on Windows.
