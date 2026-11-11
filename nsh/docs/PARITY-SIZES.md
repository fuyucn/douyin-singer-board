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

All icon-bearing buttons now go through `ui.tsx` `IconButton()`, and every raw
text button carries `items-center justify-center`. Three guards keep it that way:

- `geometry.test.tsx` — `onLayout` bounds at five icon-only sizes, plus the
  `IconButton` icon+label variant (vertical centering only). Center delta must
  be <= 1pt. Runs headless on the Windows CI.
- `text-layout.test.tsx` — fixed-height raw `<Button>` control: asserts the
  label is intrinsic-width and centered, and that an icon+label group stays on
  one row. This covers the shadcn baseline, not a substitute for the
  `IconButton` case above.
- `scripts/check_icon_buttons.py` — static guard (also on the Linux PR gate):
  no raw `<Button>` may contain `Icon({`, and every raw `<Button>` must carry
  the centering classes.

### Start button box (dark theme, 900x700)

| Build | visible box | corner inset at top row |
|---|---|---|
| Original | x 853..882, y 11..40 (30x30) | 4.0pt |
| 0.6.2 | x 852..883.5, y 9.5..41 (32x32) | 5.5pt |
| **0.6.3** | **x 853..882.5, y 10.5..40 (~30x30)** | **3.5pt** |

The original's shadcn base class has `border border-transparent`, so a
`size-8` (32px) button paints a 30x30 rounded box. 0.6.3 uses an explicit
`ml-[9px] mr-[1px] h-[30px] w-[30px] rounded-[6px]` to match it: the 9pt
left + 1pt right margin keeps the right action group's footprint at 40pt, so
the three preceding icon buttons stay at 756.8 / 790.8 / 824.8 (measured in
0.6.3). The Stop button uses the same box and now draws a **white** filled
square (`text-white` in the original), not the dark `destructive-foreground`
token. `scripts/check_icon_buttons.py` asserts this exact class string, the
white color and `Icon()`'s hex support, because the geometry tests only cover
centering.

The 3.5pt top-corner inset still differs from the original's 4.0pt by 0.5pt;
at 2x sampling the inset metric is coarse and cannot prove a 6px vs
`bg-clip-padding` 5px radius difference. The radius is therefore reported as
"within 0.5pt", not as an exact match.

## Icon centering (start button, dark theme)

| Build | dx | dy |
|---|---|---|
| Original | +1.0 | -0.5 |
| 0.6.0 (before) | **-7.75** | **-7.75** |
| 0.6.1 / 0.6.2 | +0.75 | 0.0 |

The other three header icon buttons in 0.6.1: dx within -0.3..+0.3pt,
dy within -0.8..+0.8pt. The start button's +0.75pt is the triangle's optical
center (the original is +1.0pt). The geometry harness reports 0.00..0.50pt at
every icon-only size.

## Button size table (points)

| Slot | Original button | Original icon | NSH button | NSH icon |
|---|---|---|---|---|
| theme / about / kugou | 30x30 | 15x15 | 30x30 | 15x15 |
| start / stop | outer 32x32 incl. 1px transparent border; **visible 30x30** | 15x15 | 30x30, rounded-[6px] | 15x15 |
| table row actions | 28x28 | 14x14 | 28x28 | 14x14 |
| played-search clear, log chevron | 24x24 | 12-14 | 24x24 | 14x14 |
| blacklist add | 32x32 | 16x16 | 32x32 | 16x16 |
| clear-list (icon + text) | h-7 (28pt), gap-1 | 14x14 | h-7 (28pt), gap-1 | 14x14 |
| log copy / log clear (icon + text) | auto height ~18pt, gap-0.5 | 12x12 | h-6 (24pt), gap-1 | 12x12 | known difference |

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
| **0.6.3 (3 icons, gap-1)** | **756.8** | **790.8** | **824.8** | **866.5** |

0.6.3 matches the original's **three-icon** layout for the first three
icons exactly; the start glyph center is 866.5 vs the original's 867.3
(-0.8pt, within the 1pt icon tolerance). When the
original has Kugou disabled it shows only two icons (790.5 / 825.0); NSH always
shows three, so that branch is ~34pt further left. That is a known branch
difference, not a measured match.

The middle button is also a semantic change: the original shows a Kugou login
icon there, NSH shows a settings gear. It follows the user's instruction to put
plugin management inside Settings, but it has not been separately signed off —
see "Open questions" below.

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

The table above covers plain Text/Input labels and tab titles only; it does
**not** cover button labels. Button-label geometry is covered by
`text-layout.test.tsx` (center delta <= 1pt) plus a screenshot check of 添加:
original (231, 603), 0.6.2 (231.5, 605.5), delta (+0.5, +2.5)pt. No text
overflow or clipping at the minimum window size; the sidebar scrolls, as in the
original.

## Remaining known differences (checked, not fixed)

These come from NSH's native layout defaults, not from missing classes:

- `flexShrink` defaults to 0 in NSH (CSS defaults to 1). Long song names and
  narrow layouts can overflow instead of shrinking. `min-w-0` / `truncate` are
  applied at the known sites; a full audit of every `flex-1` is still pending.
- A view with no `display` lays children out in a **column** and stretches them
  on the cross axis. Measured in `text-layout.test.tsx`: without centering, a
  label inside a 32pt button was stretched to 848pt and pinned at y=0; with
  `items-center justify-center` it is intrinsic-width and centered. All raw
  text buttons in `Board.tsx` now carry those classes.
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

| Area | Original | NSH 0.6.3 | Status |
|---|---|---|---|
| Header middle button | Kugou login icon (when `kugou_enabled`) | Settings gear | Follows "plugins in Settings", not separately confirmed |
| About | version, check update, telemetry toggle, show-logs toggle, Kugou feature toggle, skipped-version reset | 关于 tab in Settings: version, repo, check update | Simplified; telemetry/log/Kugou switches not ported |
| Settings dialog | none (config in left panel) | one modal with 常规 / 插件 / 关于 tabs | Follows "plugins in Settings" + 0.7.0 tabs request |
| Log panel visibility | toggled from About | shown automatically once logs exist | Simplified |
| Stop icon | white filled square (`fill-current text-white`) | white filled square from 0.6.3 | Fixed; verified in `final-stop.png` (connected state) |
| Button labels | inline-flex centered | centered from 0.6.2 | Fixed |
| Start/stop box | visible 30x30, radius 6px | 30x30, radius 6px from 0.6.3 | Fixed; corner inset within 0.5pt |
| Header ghost icon buttons | size 30px incl. 1px border; hover highlight 28x28 | 30x30, radius 6.4pt | Known 2pt difference in hover state only; not changed to avoid shifting the group |
| Blacklist | song + singer entries, right-click add from table | song + singer via input bar | Right-click add not ported |
| Kugou token | refresh via `/login/token`, `/user/listen` bias, playlist clear/recreate | QR login only | Previously documented gap |

## 0.7.2 start/stop palette → 0.7.9 revert

0.7.2 made Start green at the user's request. 0.7.9 reverts Start to the
original's neutral `bg-foreground active:bg-muted-foreground` (measured:
light rgb(35,37,39) on the light header, white on the dark header); Stop
keeps 0.7.2's red.

The 0.7.2 palette, kept for reference:

The user asked for a green Start and red Stop button. Measured from
`--target macos` screenshots (button box x 853..882, y 11..40):

| Theme | Start background | Stop background |
|---|---|---|
| light | rgb(74, 136, 105) green | rgb(182, 74, 66) red + white square |
| dark | rgb(113, 187, 149) green | rgb(182, 74, 66) red + white square |

Implementation: `bg-success active:bg-success-hover` for Start, and a fixed
`bg-[#c5403c] active:bg-danger-hover` for Stop. The theme's dark
`destructive` token is a pale salmon (#ef7d77); a white square on it was only
~2.4:1 contrast, so Stop now uses the same unambiguous red in both themes
(~5.5:1). The Start glyph keeps `color="background"` (dark on pale green in
dark theme, near-white on deep green in light theme).

Not verified: icon color after switching theme at runtime (the data-URI SVG
pipeline froze colors once before), `active:` hover rendering (static
screenshots never trigger it), and Windows Direct2D color/DPI output.

**This is an intentional deviation from the original Tauri app**, whose Start
button is `bg-[var(--fg-base)]` — near-black in light theme, near-white in
dark — in both `main` and `feat/susu`. Only Stop was red there. The palette is
guarded in `scripts/check_icon_buttons.py`.

## 0.7.1 interaction fixes

Row copy/mark/delete buttons were drawn inside `DataTable.renderCell`. On a
real renderer (`nsh test --target macos`) `app.press` finds the element but its
`onPress` never fires, while headless tests call `onPress` directly and stayed
green. Verified by target diagnostics: tab-bar `clear-list`, sidebar `添加` and
blacklist `black-add` all worked; only table-cell buttons did not. 0.7.1
worked around this with a toolbar above each table; 0.7.9 replaces both tables
with plain view rows (`songRows().map(...)` inside a `Scroll` under a sticky
header) and restores the original's inline actions per row. Column widths now
mirror the original (`#40 / 用户120 / 点歌 grow / 时间72 / actions110`; played
`#40 / 时间80 / 用户110 / 点歌 grow / actions48`), where 0.7.1 had fixed the
song column at 260 instead of growing. Actions keep 60% opacity, full on
hover. Caveat: the original virtualizes rows; these lists render every row.

Copy/rename/delete/join/clear actions were only checked for appearance. The
clipboard capability was undeclared, so `Clipboard.writeText` rejected silently;
`log()` ran before the promise settled, which made the log claim a success that
never happened. `actions.test.tsx` (8 cases) and `table-actions-target.test.tsx`
(3 cases, also run with `--target macos`) assert the clipboard contents, that
the deleted row's text disappears, that clearing played resets the stale search
filter, and that a non-first row's inline buttons act on that row (0.7.9:
selected-row state is gone; buttons are bound to their own row's `msg_id`).
Coverage is limited to the buttons named in those tests; the remaining "no
visible change" paths (theme, log fold, playlist selection) are not asserted.

## 0.7.0 Settings tabs

The single modal is 560x520pt (fits the 880x560 minimum window). Its header
keeps the 48pt title bar, then a 40pt underline tab row reusing the main
window's tab style. Only the selected tab is mounted (`If`), so hidden tab
text never leaks into `app.texts()`. Tab testIDs: `settings-tab-general`,
`settings-tab-plugin`, `settings-tab-about`; close is `settings-close`.

Icon geometry measurements above are from 0.6.3 and were not retaken for
0.7.0: the header buttons themselves did not change, only where their
`onPress` navigates.

## Evidence location

The connected/Stop screenshot and all other screenshots live in the delivery
folder `~/Desktop/nsh-singe/screenshots/` (not in the repo). `button-check.html`
in the same folder embeds zoomed crops as data URIs, so it opens on a phone
without any sibling files.

## Not done in this pass (previous review items P4 / P6)

- P4: the original with Kugou disabled shows only two header icons; NSH always
  shows three. That branch remains ~34pt further left (documented above).
- P6: no automated absolute-x test for the header, no dialog geometry
  comparison, no theme-switch color regression test, no logged-in Kugou
  sidebar screenshot, no About parity items, and no right-click blacklist add.
  These are tracked as follow-ups, not claimed as verified.
- P11: `App.tsx` is the POC "counts taps" entry and still has uncentered raw
  Buttons. The shipping entry is `Board.tsx`, which the guard covers.

## Open questions for the user

1. Is replacing the header's Kugou-login icon with a Settings gear acceptable,
   or should both be present (plugin management still lives in Settings)?
2. Is "control centers within 1pt + matching row heights/spacing/colors" the
   right acceptance bar, or is exact WebKit-like rendering required?
3. The About modal is still simplified (no telemetry / show-logs / Kugou
   switches). Are those needed before parity sign-off?

## What "parity" can and cannot mean

The original is a Chromium CSS box model; NSH is a native flex/grid layout with
platform text rendering. **Pixel-identical is not achievable.** The check applied here (pending user
sign-off) is: **icon/button center delta <= 1pt** (automated, headless);
**text labels within +/-3pt** (measured by OCR; native font metrics differ);
row heights and spacing matching; colors/theme matching. The measured tabs x
(+3/+4.5pt) and 添加 y (+2.5pt) are within the text tolerance, not the 1pt
icon tolerance. If exact WebKit rendering is required, the only
option is to host the original React frontend in an NSH WebView, which gives up
the native-rendering size win and needs WebView2 on Windows.
