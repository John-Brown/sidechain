---
paths:
  - "apps/web/src/**/*.svelte"
  - "apps/web/src/**/*.css"
  - "apps/web/src/lib/components/viewer/**"
---

# Style Guide — Deco Parchment

Warm parchment surfaces, ink text, one teal for interaction, amber for ornament. Two themes: **Day** (default, `@theme` in `app.css`) and **Night** (`.dark` on `<html>`). Both must look right. 2px radius everywhere, no shadows, motion limited to 150–200ms color/border transitions.

## Typefaces

All self-hosted via @fontsource and imported in `app.css` before Tailwind. No Google Fonts, no CDN.

```css
@import "@fontsource-variable/dm-sans";
@import "@fontsource/ibm-plex-mono/400.css";
@import "@fontsource/ibm-plex-mono/500.css";
@import "@fontsource/dm-serif-display";
@import "tailwindcss";
```

| Token | Class | Family | Use |
|-------|-------|--------|-----|
| `--font-sans` | `font-sans` (default) | DM Sans Variable | Body, buttons, track labels, block text |
| `--font-mono` | `font-mono` | IBM Plex Mono 400/500 | Numbers, timecodes, uppercase labels, kbd glyphs, code |
| `--font-serif` | `font-serif` | DM Serif Display | Panel titles, dialog headings, the Inspector's category label. **Never on the timeline.** |
| `--tracking-label` | `tracking-label` | 0.1em | Mono uppercase labels |

Body has `antialiased`.

## Mono usage (numbers and labels, not just code)

Use `font-mono` for:
- **Timecodes and durations** (header time, ruler, inspector time rows, queue times, locked-range ranges)
- **Measured values**: zoom in px/s (`72 px/s`), confidences (`0.48`), counts (`31 / 46`), thresholds (`thr 0.50`)
- **Uppercase labels**: `font-mono uppercase tracking-label` at 10–11px (section eyebrows like INSPECTOR, NEEDS REVIEW, TASK; button labels in the viewer header/toolbar; track group headers)
- **Kbd hints** (`⌘E`, `⇥`, `↵`, `1–6`) and code / JSON / debug output

Do not use mono for: sentence text, track names ("Waveform", "VAD"), block labels (words, categories), dialog body copy.

Plex Mono digits are already fixed-width, so `tabular-nums` isn't needed on mono text (it's harmless). Keep `tabular-nums` for numbers set in DM Sans.

## Type Scale — App Pages

Standard Tailwind utilities, `--font-sans` by default.

| Role | Class | Size | Weight |
|------|-------|------|--------|
| Page heading | `text-2xl font-semibold tracking-tight` | 24px | 600 |
| Section heading | `text-lg font-semibold` | 18px | 600 |
| Body / inputs / buttons | `text-sm` | 14px | 400 |
| Button labels, table headers | `text-sm font-medium` | 14px | 500 |
| Badges / captions | `text-xs` | 12px | 400–500 |

## Type Scale — Viewer Density

Custom tokens in `app.css` `@theme`. They generate Tailwind utilities.

| Token | Class | Size | Line-height | Use |
|-------|-------|------|-------------|-----|
| `--text-viewer-xs` | `text-viewer-xs` | 10px | 1 | Block text, mono uppercase labels, canvas labels |
| `--text-viewer-sm` | `text-viewer-sm` | 11px | 1.2 | Header controls, timecodes, status bar |
| `--text-viewer-base` | `text-viewer-base` | 12px | 1.2 | Track labels, body text in panels |
| `--text-viewer-md` | `text-viewer-md` | 13px | 1.45 | Task brief, the Inspector's confidence value |

Serif headings in viewer panels are the exception (19px header title, 24px inspector category).

### Rules

- **No arbitrary pixel sizes** like `text-[10px]`. Use the viewer tokens.
- **Canvas font strings** come from the constants in `tracks/draw-functions.ts`: `RULER_FONT` (`'10px "IBM Plex Mono", monospace'`) for timecodes and `CANVAS_LABEL_FONT` (`'10px "DM Sans Variable", sans-serif'`) for text labels. `CANVAS_TAG_FONT` (Plex Mono) is for short tags like the diarization `S0`.

## Weight Strategy

| Role | Class | Numeric |
|------|-------|---------|
| Page/section headings | `font-semibold` | 600 |
| Buttons, labels, badges, human blocks | `font-medium` | 500 |
| Body, inputs, descriptions, AI blocks | (default) | 400 |

Don't use `font-bold` (700) or `font-light` (300). The serif has a single weight.

## Color System

### App tokens (`app.css`)

Day values in `@theme`, Night overrides in `.dark`. Use via Tailwind utilities (`bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`, `hover:bg-primary-hover` …).

| Token | Day | Night | Role |
|-------|-----|-------|------|
| `background` / `foreground` | `#f5f0e8` / `#2a2520` | `#1c1814` / `#f0e9dd` | Parchment page, ink text |
| `card`, `popover` | `#faf7f2` | `#242019` | Raised surfaces, panels |
| `secondary`, `muted` | `#ede7db` | `#2e2821` | Inset surfaces, neutral badges |
| `muted-foreground` | `#6b5f54` | `#b5a795` | Secondary text that must be read |
| `subtle-foreground` | `#9a8e82` | `#7f7264` | **Hints only** (see contrast rule) |
| `primary` / `primary-foreground` | `#1a6b5a` / `#fff` | `#3fa78d` / `#1c1814` | Teal: interactive only |
| `primary-hover` | `#134d41` | `#6cc9ad` | Hover for primary fills (lighter on Night) |
| `accent` | teal 5% | teal 10% | Hover wash, edit-mode wash, selected row |
| `destructive` | `#a3322a` | `#ec8373` | Brick: errors, delete, failed. Same value as `--hue-challenge` |
| `border`, `input` | `#c9bfb0` | `#4a4034` | Rules and field borders |
| `ring` | `#1a6b5a` | `#3fa78d` | Focus ring |
| `ornament` | `#b8860b` | `#d4a02a` | Amber: decorative only |

**Teal is for interactive elements only**: buttons, links, the active mode segment, selection outlines, focus rings, resize handles, sliders, checkmarks. Don't use it for decoration or plain status. (App-page "ready/active" badges use `bg-primary/10 text-primary` as the one status exception.)

**Amber is decorative only**: `◆` separators, the 2px top stripe on panels and dialogs, the 4px InfoBox left border (draft-recovery banner), 6px rotated-square bullets. Never on text that must be read, never as a state color.

Status badges on app pages: positive `bg-primary/10 text-primary`, in-progress `bg-secondary text-secondary-foreground`, neutral/paused `bg-muted text-muted-foreground`, failed `bg-destructive/10 text-destructive`. No raw Tailwind hues (`amber-*`, `indigo-*`, `green-*`, `red-*`, `slate-*` …) anywhere.

### Contrast rule for dim text

`subtle-foreground` / `--viewer-text-subtle` (`#9a8e82` on parchment ≈ 2.9:1) fails 4.5:1 at small sizes. Use it only for **redundant** hints: kbd glyphs next to a labelled button, table column headers, placeholder counts. Anything the annotator needs to read uses `muted-foreground` / `--viewer-text-dim`.

### Viewer tokens (`viewer.css`)

`.viewer-theme` maps onto the app tokens, so Night follows `.dark` automatically.

| Variable | Maps to | Use |
|----------|---------|-----|
| `--viewer-bg` | `background` | Label column, ruler |
| `--viewer-surface` | `card` | Track content, panels |
| `--viewer-surface-2` | `secondary` | Group headers, video bar, insets |
| `--viewer-border` | `border` | Rules, grid |
| `--viewer-text` / `--viewer-text-dim` / `--viewer-text-subtle` | `foreground` / `muted-foreground` / `subtle-foreground` | Text tiers |
| `--viewer-accent` / `-hover` / `-fg` / `-bg` | `primary` / `primary-hover` / `primary-foreground` / `accent` | Interactive teal and its wash |
| `--viewer-danger` / `-fg` | `destructive` / `destructive-foreground` | Errors, delete |
| `--viewer-ornament` | `ornament` | Amber ornament |
| `--viewer-playhead` | `#b5391f` / `#f07a5a` | Playhead (brick, the warmest mark on screen) |
| `--viewer-lock-hatch` | ink 7% / 10% | Locked-range hatch |
| `--viewer-warning-*` | card / ornament / foreground / primary | Draft-recovery InfoBox |

Utilities: `bg-viewer-surface`, `bg-viewer-surface-2`, `bg-viewer-bg`, `bg-viewer-accent-bg`, `text-viewer-text`, `text-viewer-text-dim`, `text-viewer-text-subtle`, `text-viewer-accent`, `text-viewer-danger`, `border-viewer-border`.

### Data hues (`--hue-*`)

Ten muted, warm-leaning categorical hues, Day / Night. They extend Deco Parchment, which has no categorical colors. Speaker 0 and inform are dusty blues on purpose so they stay distinct.

| Hue | Day | Night | Data |
|-----|-----|-------|------|
| `--hue-spk-0` | `#3d5873` | `#8fb0cf` | Speaker 0 (words, waveform L, diarization) |
| `--hue-spk-1` | `#9a4526` | `#e39170` | Speaker 1 |
| `--hue-speaking` | `#4f6b2e` | `#a9c47f` | State: speaking, mouth energy |
| `--hue-listening` | `#6b5f54` | `#b5a795` | State: listening |
| `--hue-engage` | `#71406a` | `#c99bc0` | Intent: engage |
| `--hue-inform` | `#4e5f86` | `#a3b0d8` | Intent: inform (and backchannel) |
| `--hue-inquire` | `#87601a` | `#dcb060` | Intent: inquire |
| `--hue-challenge` | `#a3322a` | `#ec8373` | Intent: challenge (= destructive) |
| `--hue-comfort` | `#9c4a5c` | `#e39aab` | Intent: comfort |
| `--hue-celebrate` | `#5f6b1f` | `#c2c870` | Intent: celebrate |
| `--hue-label` | `#6b5f54` | `#b5a795` | User labels |

### Block recipe (DOM tracks)

One base class plus one hue class. State lives in attributes, never in per-block classes or effects:

```html
<div class="blk hue-intent-inquire" data-source="ai" data-lowconf aria-selected="true" tabindex="-1">
```

| State | Selector | Look |
|-------|----------|------|
| AI prediction | `.blk` | 10% tint (Night 16%), 45% border (Night 55%), text in the hue, weight 400 |
| Human / confirmed | `[data-source="human"]`, `[data-source="supervisor_override"]` | Solid hue border, 22% tint (Night 30%), weight 500, static 2px inset ink cap |
| Low confidence | `[data-lowconf]` (conf < `LOW_CONFIDENCE` = 0.6, from `viewer/review.ts`) | Dashed border at 90% of the hue + 135° hatch at 30% (Night 34%) |
| Selected | `[aria-selected="true"]` | 2px teal outline, 1px offset, `z-index: 3` |
| Locked (task) | `[data-locked]` | 40% opacity under the ink hatch overlay |
| Focused | `:focus-visible` | 2px teal outline, 1px offset |

Hue classes: `hue-spk-0`, `hue-spk-1`, `hue-speaking`, `hue-listening`, `hue-intent-{engage,inform,inquire,challenge,comfort,celebrate}`, `hue-label`, `hue-backchannel`.
Handles: `.blk-handle.blk-handle-start` / `.blk-handle-end`, 4px teal bars rendered only on the selected block in edit mode. Drag origin: `.blk-ghost` (dashed, no fill).
**No transitions and no shadows on `.blk`** (the human ink cap is static). Blocks use a roving tabindex per track.

Locked ranges: `.locked-region-overlay` is a neutral ink hatch (`--viewer-lock-hatch`, 135°, 3px on / 5px off) with a LOCKED tag, never red.

### Playhead

`--viewer-playhead` / `palette.playhead`: brick `#b5391f` (Day), `#f07a5a` (Night). No neon red.

### Canvas palette

Canvas code (`draw-functions.ts`, `mesh-overlay.ts`, the overview) takes **every** color from the `ViewerPalette` parameter (`viewer-palette.ts`), `$derived` in AnnotationViewer from the `.dark` class on `<html>` (a MutationObserver keeps it in step with the DOM). `PALETTE_LIGHT` / `PALETTE_DARK` mirror the tokens above and add `lockHatch`, `lowConfMarker`, `overviewWindow` + `overviewWindowBg` (the accent-bg wash: 5% Day, 10% Night), the diarization `speaker0/1/Default` pairs, and `meshDepth` (8-step warm ramp: ink-blue → sage → ochre → brick). Keep `app.css`, `viewer.css` and `viewer-palette.ts` in sync.

## Conventions

- **Themes**: Day is the default. Night is the `.dark` class on `<html>` (`@custom-variant dark (&:where(.dark, .dark *))`), not `prefers-color-scheme` in CSS.
- **Radius**: 2px everywhere. `--radius` and every `--radius-*` step are 2px, so `rounded`, `rounded-sm`, `rounded-md`, `rounded-lg` all render 2px. `rounded-full` only for tiny status dots.
- **Shadows**: none (the static inset ink cap on human blocks is the one exception).
- **Focus**: `:focus-visible` gets a 2px teal outline with a 1–2px offset. The base rule in `app.css` (`outline: 2px solid var(--color-ring); outline-offset: 2px`) covers every focusable element; components tighten the offset (blocks 1px, list rows −2px inset). App-page fields use `focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring`, never `ring-*` (a ring is a box-shadow).
- **Motion**: `transition-colors` (150–200ms) on interactive elements only. Nothing on blocks or layout during playback or drag.
- **Overlays** use bits-ui 2.x styled with these tokens: Dialog (Classify, Label text, Submit, Shortcuts), DropdownMenu (the block context menu), Slider (header zoom, mesh opacity). Select and Tooltip are allowed when needed (icon buttons use `title` today). The timeline, tracks and blocks stay hand-rolled.
- **Theme default**: `stores/theme.svelte.ts` starts at `light`; `app.html` adds `.dark` before paint only for a stored `dark`, or a stored `system` on a dark OS.
- **Spacing**: Tailwind defaults (4px grid). The viewer is denser than app pages.
