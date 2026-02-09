---
paths:
  - "apps/web/src/lib/components/viewer/**"
---

# Viewer Architecture

## Three-Context State System

AnnotationViewer.svelte creates and provides three state objects via Symbol-keyed context:

| Context | Class | Key Fields | Set In |
|---------|-------|-----------|--------|
| `getTimelineState()` | `TimelineState` | currentTime, duration, playing, zoom, scrollLeft, containerWidth, scrubbing | AnnotationViewer |
| `getAnnotationDataState()` | `AnnotationDataState` | vad, transcription, diarization, mouthEnergy, stateAnnotation, intentClassification, userLabels, loadStatus | AnnotationViewer |
| `getSessionState()` | `SessionState` | videoId, videoSrc, filename, selectedAnnotation, pipActive, pipSupported, waveform* | AnnotationViewer |
| `getEditorState()` | `EditorState` | editing, states, intents, transcription, backchannels, userLabels, selectedType, selectedIndex, *History | AnnotationViewer |

To add new viewer-wide state: create class in `state/`, add Symbol+getter/setter in `context.ts`, instantiate in AnnotationViewer.

## Timeline Math

All time conversions go through `TimelineState`:
- `timeToPx(seconds)` → `seconds * zoom`
- `pxToTime(pixels)` → `pixels / zoom`
- `viewStartTime` / `viewEndTime` — derived from scrollLeft + containerWidth + zoom

## Track Types

**CanvasTrack** — continuous data (VAD, energy, diarization, mouth energy). Draw callback receives `(ctx, width, height, viewport)`. Uses RAF loop when playing/scrubbing. Handles DPR scaling.

**DOMTrack** — discrete blocks (transcription, states, intents, user labels in view mode). Generic `<T>` with `getStart`/`getEnd`/`blockClass`/`blockLabel` props. Viewport-culled via binary search (`utils/binary-search.ts`). Blocks are absolutely-positioned `<button>` elements with `will-change: transform`.

**EditableDOMTrack** — editable version of DOMTrack (states, intents, transcription, backchannels, user labels in edit mode). Adds drag-resize (left/right handles) and drag-move (block body, 3px threshold). Selection via click. Undo snapshot on commit. See `.claude/rules/editing.md` for drag protocol.

## Viewport Culling

Both track types use binary search from `utils/binary-search.ts`:
- `binarySearchStart(items, time)` — first item ending after `time`
- `binarySearchEnd(items, time)` — last item starting before `time`

Only items in `[viewStartTime, viewEndTime]` are rendered/drawn. This is critical for 10K+ item datasets.

## Component Hierarchy

```
AnnotationViewer → ViewerHeader, VideoPlayer, InspectorPanel, Timeline[
  Playhead, TrackRow[CanvasTrack | DOMTrack] × N
]
```

## Picture-in-Picture

Browser PiP API floats the video and collapses the left panel to give timeline full width.

- `SessionState.pipSupported` — feature-detected in constructor (`document.pictureInPictureEnabled`)
- `SessionState.pipActive` — toggled by `enterpictureinpicture`/`leavepictureinpicture` events on `<video>`
- `VideoPlayer.togglePip()` — exported method, calls `requestPictureInPicture` / `exitPictureInPicture`
- Left panel collapse: CSS `w-0 overflow-hidden` (not `{#if}` removal — destroying `<video>` kills PiP)
- Keyboard shortcut: `P`
- PiP events not in Svelte's type defs — attached imperatively in `onMount`, cleaned up on destroy
- `ResizeObserver` on timeline container auto-updates `containerWidth` → all tracks redraw at new width

## CSS Theme

Custom properties in `viewer.css` (`.viewer-theme`): `--viewer-bg`, `--viewer-surface`, `--viewer-surface-2`, `--viewer-border`, `--viewer-text`, `--viewer-text-dim`, `--viewer-accent`, `--viewer-playhead`. Light/dark variants via `.dark .viewer-theme`.

Block colors: `.block-speaker-0` (cyan), `.block-speaker-1` (pink), `.block-speaking` (green), `.block-listening` (slate), `.block-intent-*` (one per intent type), `.block-user-label` (violet). Each has light default + `.dark` override.

Canvas draw functions receive a `ViewerPalette` object (from `viewer-palette.ts`) — theme-aware colors for fills, strokes, labels. Palette is `$derived` from the theme state in AnnotationViewer.

## Typography

Inter Variable is the project typeface, loaded via `@fontsource-variable/inter`. See `.claude/rules/style-guide.md` for the full type scale.

Viewer-specific density tokens (defined in `app.css` `@theme`):

| Token | Class | Size | Use |
|-------|-------|------|-----|
| `--text-viewer-xs` | `text-viewer-xs` | 9px | Canvas labels, DOM block text |
| `--text-viewer-sm` | `text-viewer-sm` | 10px | Status text, zoom label |
| `--text-viewer-base` | `text-viewer-base` | 11px | Track labels |

Rules:
- **No arbitrary pixel sizes** (`text-[9px]`, etc.) — use viewer tokens instead
- **No `font-mono`** on track labels, time displays, or DOM blocks — use `tabular-nums` for fixed-width digits
- **`font-mono`** is reserved for inspector panel JSON and code display
- Canvas `ctx.font` strings use `"Inter Variable", sans-serif`, not `monospace`
