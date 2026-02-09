---
paths:
  - "apps/web/src/**/*.svelte"
  - "apps/web/src/**/*.css"
  - "apps/web/src/lib/components/viewer/**"
---

# Style Guide

## Typeface

**Inter Variable** (`@fontsource-variable/inter`) — self-hosted, loaded in `app.css` before Tailwind. Variable weight axis 100–900. No Google Fonts, no external CDN.

```css
/* app.css — font-face registers before Tailwind reset */
@import "@fontsource-variable/inter";
@import "tailwindcss";
```

Registered in `@theme`:
```css
--font-sans: "Inter Variable", ui-sans-serif, system-ui, -apple-system, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
```

Body has `antialiased` for subpixel rendering.

## Type Scale — App Pages

Standard Tailwind utilities. Inter adoption is automatic via `--font-sans`.

| Role | Class | Size | Weight |
|------|-------|------|--------|
| Page heading | `text-2xl font-semibold tracking-tight` | 24px | 600 |
| Section heading | `text-lg font-semibold` | 18px | 600 |
| Body / inputs / buttons | `text-sm` | 14px | 400 |
| Button labels, table headers | `text-sm font-medium` | 14px | 500 |
| Badges / captions | `text-xs` | 12px | 400–500 |

## Type Scale — Viewer Density

Custom tokens in `app.css` `@theme` for the high-density annotation viewer. These generate Tailwind utilities.

| Token | Class | Size | Line-height | Use |
|-------|-------|------|-------------|-----|
| `--text-viewer-xs` | `text-viewer-xs` | 10px (0.625rem) | 1 | Canvas labels, DOM track block text |
| `--text-viewer-sm` | `text-viewer-sm` | 11px (0.6875rem) | 1.2 | Status/loading messages, zoom label + value |
| `--text-viewer-base` | `text-viewer-base` | 12px (0.75rem) | 1.2 | Track labels (TrackLabel, TrackRow) |

### Rules

- **No arbitrary pixel sizes** — never use `text-[10px]`, `text-[11px]`, `text-[12px]`. Use the viewer tokens.
- **Canvas font strings** — use `'10px "Inter Variable", sans-serif'`, not `'10px monospace'`.

## Monospace Usage

`font-mono` is reserved for **code and raw data display only**.

| Use `font-mono` | Do NOT use `font-mono` |
|-----------------|----------------------|
| Inspector panel JSON `<pre>` blocks | Track labels ("VAD", "Waveform") |
| Inspector time range values | Time display in viewer header |
| Video detail results `<pre>` | Zoom value ("5.0x") |
| Code snippets, debug output | DOM track blocks (words, states) |

For fixed-width digits without monospace, use `tabular-nums`. Inter's tabular figures provide column-aligned numbers.

## Weight Strategy

| Role | Class | Numeric |
|------|-------|---------|
| Page/section headings | `font-semibold` | 600 |
| Buttons, labels, table headers, badges | `font-medium` | 500 |
| Body, inputs, descriptions | (default) | 400 |

Do not use `font-bold` (700) or `font-light` (300) — they're outside the project's weight range.

## Color System

### App-Level (shadcn-svelte)

Defined in `app.css` `@theme` + `.dark` override. Semantic tokens:

- `background` / `foreground` — page base
- `card` / `card-foreground` — card surfaces
- `primary` / `primary-foreground` — main action color
- `secondary`, `muted`, `accent` — supporting surfaces
- `destructive` — error/danger actions
- `border`, `input`, `ring` — form elements

Use via Tailwind utilities: `bg-background`, `text-foreground`, `border-border`, etc.

### Viewer-Level

Custom properties in `viewer.css` (`.viewer-theme` / `.dark .viewer-theme`):

| Variable | Light | Dark | Use |
|----------|-------|------|-----|
| `--viewer-bg` | `#ffffff` | `#0f1117` | Timeline background |
| `--viewer-surface` | `#f4f5f7` | `#1a1d27` | Track label background, scrollbar track |
| `--viewer-surface-2` | `#ebedf0` | `#242836` | Hover states |
| `--viewer-border` | `#d4d8e0` | `#2e3345` | Borders, grid lines |
| `--viewer-text` | `#1a1a2e` | `#e1e4ed` | Primary text |
| `--viewer-text-dim` | `#64748b` | `#8b90a0` | Secondary text, labels |
| `--viewer-accent` | `#6366f1` | `#6366f1` | Indigo accent (same both themes) |
| `--viewer-playhead` | `#ef4444` | `#ef4444` | Playhead line (same both themes) |

Accessed via utility classes: `bg-viewer-surface`, `text-viewer-text-dim`, `border-viewer-border`, etc.

### Canvas Palette

Canvas draw functions receive a `ViewerPalette` object (from `viewer-palette.ts`), not raw CSS variables. The palette is `$derived` from theme state in AnnotationViewer — canvas redraws automatically on theme change.

### DOM Track Block Colors

Defined in `viewer.css` with light defaults and `.dark` overrides. Each block variant uses a bg/border/text triple at different opacities:

- **Speakers**: `.block-speaker-0` (cyan), `.block-speaker-1` (pink)
- **States**: `.block-speaking` (green), `.block-listening` (slate)
- **Intents**: `.block-intent-engage` (indigo), `.block-intent-inform` (cyan), `.block-intent-inquire` (amber), `.block-intent-challenge` (red), `.block-intent-comfort` (purple), `.block-intent-celebrate` (emerald)

## Conventions

- **Dark mode**: toggled via `.dark` class on `<html>`. Use `@custom-variant dark (&:where(.dark, .dark *))` in Tailwind, not `prefers-color-scheme`.
- **No inline color values** in canvas draw functions — always use the `ViewerPalette` parameter.
- **Spacing**: follow Tailwind defaults (4px grid). Viewer uses tighter spacing than app pages.
- **Border radius**: `--radius: 0.5rem` (8px) for cards/buttons. DOM track blocks use `rounded-sm` (2px).
- **Transitions**: `transition-colors` on interactive elements. No transition on layout-critical elements during playback.
