---
paths:
  - "apps/web/src/lib/components/viewer/**"
---

# Viewer Architecture

Deco Parchment design pass (2026-09-24). Look, sizes and copy follow the design files, summarized in `.claude/rules/style-guide.md`. Visual check without real data: `/dev/viewer` (below).

## Layout (1920×1080 reference, `AnnotationViewer.svelte`)

Top to bottom, one `h-screen` column inside `.viewer-theme[data-viewer-root][data-mode=view|edit|task]`:

| Row | Height | Component |
|-----|--------|-----------|
| Header | 48px | `ViewerHeader`: identity (serif title ◆ mono project or task ref), transport + timecode, View\|Edit segmented (or task progress + timer), SaveIndicator, Normalize, zoom (bits-ui Slider, log scale 0.5–100 px/s), theme / shortcuts / PiP |
| Load error, draft banner | auto | inline error, `DraftRecoveryBanner` (amber InfoBox) |
| Toolbar | auto | `EditToolbar` (view/edit) or `TaskToolbar` (task: editable types, allowed and not-allowed ops, locked ranges) |
| Top band | 400px | video column 711px (`VideoPlayer` + mesh bar) · Inspector 460px (`InspectorPanel`) · `ReviewQueue`, or `TaskPanel` in task mode (1fr) |
| Ruler | 28px (`RULER_HEIGHT`) | outside the vertical scroll, follows `scrollLeft`; 184px "TRACKS n" corner cell |
| Tracks | 1fr, scrolls both ways | per group: 22px `TrackGroup` header row, then track rows = sticky 184px `TrackLabel` cell (`LABEL_WIDTH`, z-40) + `TrackContent`. An overlay in timeline coordinates holds locked ranges (z-20) and the playhead line (z-30, `cap={false}`) |
| Overview | 30px | `TimelineOverview` |
| Status bar | 24px | `ViewerStatusBar` |

PiP collapses the video column with CSS (`width: 0`), never `{#if}`, because destroying `<video>` ends PiP.

## Five-Context State System

AnnotationViewer.svelte creates and provides five state objects via Symbol-keyed context (`context.ts`):

| Context | Class | Key Fields |
|---------|-------|-----------|
| `getTimelineState()` | `TimelineState` | currentTime, duration, playing, zoom (px/s), scrollLeft, containerWidth, scrubbing, viewStart/EndTime |
| `getAnnotationDataState()` | `AnnotationDataState` | vad, transcription, diarization, facialTracking, mouthEnergy, stateAnnotation, intentClassification, backchannel, userLabels, waveform, loadStatus (+ `*Max`/`headPoseMin/Max`, latestEditTimestamp) |
| `getSessionState()` | `SessionState` | videoId, videoSrc, filename, projectName, selectedAnnotation (view-mode Inspector selection), normalized, pip*, meshOverlay*, **`tracks: TrackLayoutState`** |
| `getEditorState()` | `EditorState` | editing, states, intents, transcription, backchannels, userLabels, selectedType/Index, *History, confirm / confirmSelected |
| `getTaskModeState()` | `TaskModeState` | active, task, constraints, elapsedSecs, editCount, submitted, reviewScope, reviewedCount/totalReviewable, lowConfRemaining, checklist |

The track layout lives on `session.tracks`, not in a sixth context. To add viewer-wide state: a class in `state/`, a Symbol + getter/setter in `context.ts`, instantiated in AnnotationViewer.

`viewerMode` is derived: `task` when task mode is active, else `edit` when `editor.editing`, else `view`.

## Track Config (`state/tracks.svelte.ts`)

One `TrackConfig` array for every track (id, label, group, height, min/max, collapsed, order, kind `canvas | dom | editable`, editableType). Groups: **Audio** (waveform, vad, diarization), **Face** (mouth_energy, head_pose), **Annotations** (transcription, states, intents, backchannels, user_labels).

- Per-mode default heights are the design's `h` object (e.g. waveform 112 in view/edit, 88 in task; intents 48 / 72). Task mode collapses Face and every editable-kind track the task can't edit, except transcription (kept open as reading context). A collapsed track is an 18px strip.
- `available` (set by the viewer from load status) hides tracks with no data; hidden tracks keep their config. `visibleTracks` is what renders.
- Persistence: localStorage per user and **layout class**. View and edit share one (`default`); task has its own (`task`). ⌘E never changes heights, collapse or order. Key: `sidechain:tracks:v1:{userId|anon}:{default|task}`.
- Resize (label bottom edge, or ↑/↓ on the focused separator) and reorder (grip drag, ⌥↑/⌥↓) drag a transform-positioned guide and commit via `setHeight` / `reorder` / `move` on pointerup or drop only. `move` steps over unavailable tracks.

## Timeline Math

All time conversions go through `TimelineState`: `timeToPx(s) = s * zoom`, `pxToTime(px) = px / zoom`; `viewStartTime` / `viewEndTime` come from scrollLeft + containerWidth + zoom. `containerWidth` = scroll container width − `LABEL_WIDTH`.

## Track Types

**CanvasTrack**: continuous data (ruler, waveform, VAD, diarization, mouth energy, head pose). Draw functions in `tracks/draw-functions.ts` (`drawRuler`, `drawWaveform`, `drawVad`, `drawDiarization`, `drawMouthEnergy`, `drawHeadPose`) get `(ctx, width, height, viewport, …, palette)`. The canvas is viewport-sized at `translateX(scrollLeft)` with the context translated by −scrollLeft, so draw code uses absolute px. Redraws come from an `$effect` over what `draw` reads; there is no per-frame loop. Diarization is a read-only canvas lane (tint, 2px left bar, mono `S0` tag): clicks scrub, and turns can't be selected. Head pose spans ±30° (`DEFAULT_POSE_RANGE`) unless normalized.

**DOMTrack**: read-only blocks (view mode; transcription phrases at low zoom in every mode). Generic `<T>` with `getStart`/`getEnd`/`blockClass`/`blockLabel` plus optional `getSource`, `isLowConfidence`, `getConfidence`, `isSelected`, `isLocked`. A `role="listbox"` of `role="option"` blocks.

**EditableDOMTrack**: edit and task mode for states, intents, transcription (words), backchannels and user labels. Adds selection, drag-resize (4px teal handles on the selected block only), drag-move (3px threshold), one pre-rendered `.blk-ghost` at the drag origin, the context menu and locked-range guards. See `editing.md`.

**Block recipe** (both DOM tracks): `class="blk hue-*"` plus attributes, never per-block classes or effects: `data-source="ai|human|supervisor_override"`, `data-lowconf` (conf < `LOW_CONFIDENCE` = 0.6: dashed 90% border + hatch), `aria-selected` (2px teal outline), `data-locked`. No transitions and no shadows, except the static human ink cap. Exact values: `style-guide.md` → Block recipe.

**Roving tabindex**: one block per track has `tabindex=0`. ←/→ move between blocks (revealing culled ones via `onReveal`), and ⇥ moves between tracks natively.

**Transcription LOD**: when the average word is under 8px wide, `utils/group-words.ts` `groupWordsBySegment()` renders phrase blocks instead of words.

**TrackGroup** (22px header: chevron, count or "N hidden"), **TrackLabel** (184px: grip, name, pen or lock icon, legend, meta like `thr 0.50` / `coverage 100%` / `read-only`, the low-confidence count `3 < .60`, resize edge), **TrackContent** (fixed-height clipped cell, `data-track-content`).

## Viewport Culling

Mandatory for every DOM track and for any canvas code that iterates items, via `utils/binary-search.ts`:
- `binarySearchStart(items, time)`: first item ending after `time`
- `binarySearchEnd(items, time)`: last item starting before `time`

Only items in `[viewStartTime, viewEndTime]` are rendered or drawn (drawVad, drawDiarization, the DOM tracks, and `lowConfInView` for label counts).

## Review Queue (`review.ts`, `components/ReviewQueue.svelte`)

`buildReviewQueue({ intents, words })` lists AI items below `LOW_CONFIDENCE` that no human has decided on, sorted by time. ReviewQueue shows it with All / Intents / Words filters; rows reviewed this session stay listed, dimmed with a ✓. ⇥ / ⇧⇥ (`nextReviewItem` / `prevReviewItem`) step from the playhead or the selection; in task mode the queue is narrowed to `taskMode.reviewScope`. Selecting a row selects the item (editor selection in edit/task, Inspector selection in view), seeks and reveals it. After a **pointer** click on a queue or mini-queue row, focus moves to the viewer root (`tabindex=-1`) so ↵ and ⇥ keep driving review. Keyboard activation (↑/↓ + ↵ inside the listbox) keeps focus in the list.

## Overview (`components/TimelineOverview.svelte`)

A 30px whole-video canvas: two speaker lanes (diarization, else words), low-confidence ticks, locked ranges (ink hatch), the current window (`palette.overviewWindow` outline + `overviewWindowBg` wash) and the playhead. The data layer is drawn once to an offscreen canvas when data, palette or size change; scroll and playback only blit it and draw the window and playhead. Drag the window to scroll, click to seek. It is a `role="slider"`: ←/→ pan 10% of the window, ⇧←/→ a full window, Home/End jump to the ends.

## Status Bar (`components/ViewerStatusBar.svelte`)

A 24px mono bar: mode (`VIEW` / `EDIT · autosave on` / `TASK · verify intents`) · window range · selection (`Selected intent #12 · 00:59.603 – 01:03.710`), with per-mode shortcut hints on the right.

## Palette and Theme

Canvas code takes every color from `ViewerPalette` (`viewer-palette.ts`, `PALETTE_LIGHT` / `PALETTE_DARK`). AnnotationViewer picks the palette from the `.dark` class on `<html>`, watched by a MutationObserver, so the canvas always matches the DOM whatever set the class (theme store, `app.html`, `/dev/viewer?theme=`). Day is the default (`stores/theme.svelte.ts` starts at `light`).

## Dev Fixture Route (`/dev/viewer`)

`routes/dev/viewer/+page.ts` 404s unless `dev`, then lazy-imports `fixtures/generate.ts` and builds `createViewerFixture({ mode })`: deterministic, seeded from the design's `timeline-data.js`, typed to `@annotation/shared`. `ssr = false`. Query params: `?mode=view|edit|task`, `?theme=day|night` (toggles `.dark` for this page only; never saved, restored on unmount), `?t=53.6` (initial playhead). The root layout renders it full-screen with no app shell.

AnnotationViewer's optional `fixture` prop skips Supabase, tRPC and the data loader. `loadFixture()` fills the state classes, the duration comes from the fixture, `mode=task` activates task mode from `fixture.task`, autosave stays in memory (no drafts), and the zoom starts at the design's 72 px/s window.

## Component Hierarchy

```
AnnotationViewer
├─ ViewerHeader [SaveIndicator, Slider, ThemeToggle, KeyboardShortcutsHelp]
├─ DraftRecoveryBanner?
├─ EditToolbar | TaskToolbar
├─ top band: VideoPlayer [MeshOverlay, Slider] · InspectorPanel · ReviewQueue | TaskPanel
├─ ruler: CanvasTrack(drawRuler) + Playhead
├─ tracks: (TrackGroup + (TrackLabel + TrackContent[CanvasTrack | DOMTrack | EditableDOMTrack]) × n) × groups
│          + locked-range overlays + Playhead(cap=false)
├─ TimelineOverview
├─ ViewerStatusBar
└─ ClassifyDialog? · LabelTextDialog? · ContextMenu? · TaskSubmitDialog?   (bits-ui, mounted on demand)
```

## Picture-in-Picture

- `SessionState.pipSupported` is feature-detected (`document.pictureInPictureEnabled`); `pipActive` follows `enterpictureinpicture` / `leavepictureinpicture` on `<video>` (attached imperatively; they aren't in Svelte's type defs)
- `VideoPlayer.togglePip()`; shortcut `P`; the video column collapses with CSS only

## Mesh Overlay

`components/MeshOverlay.svelte` (inside VideoPlayer) draws the face mesh from `FacialTrackingResult.mesh_keyframes` and Depth Anything V2 depth, using the `mesh-overlay.ts` helpers and `palette.meshDepth`. It is controlled by `SessionState.meshOverlayVisible` (F), `meshOverlayOpacity` (bits-ui Slider in the mesh bar) and `meshVideoHidden` (V).

## CSS and Typography

`viewer.css` holds `.viewer-theme` (maps `--viewer-*` onto the app tokens, so Night follows `.dark`), the `--hue-*` data hues, the `.blk` recipe, `.locked-region-overlay` and the focus-visible rules. Fonts: DM Sans (UI, block text, track names), IBM Plex Mono (numbers, timecodes, uppercase labels, kbd), DM Serif Display (panel and dialog titles, never on the timeline). Density tokens: `text-viewer-xs` 10px, `-sm` 11px, `-base` 12px, `-md` 13px. Canvas fonts come from `RULER_FONT` / `CANVAS_LABEL_FONT` / `CANVAS_TAG_FONT` in `draw-functions.ts`. Full rules: `style-guide.md`.
