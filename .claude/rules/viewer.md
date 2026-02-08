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
| `getAnnotationDataState()` | `AnnotationDataState` | vad, transcription, diarization, mouthEnergy, stateAnnotation, intentClassification, loadStatus | AnnotationViewer |
| `getSessionState()` | `SessionState` | videoId, videoSrc, filename, selectedAnnotation, pipActive, pipSupported, waveform* | AnnotationViewer |

To add new viewer-wide state: create class in `state/`, add Symbol+getter/setter in `context.ts`, instantiate in AnnotationViewer.

## Timeline Math

All time conversions go through `TimelineState`:
- `timeToPx(seconds)` → `seconds * zoom`
- `pxToTime(pixels)` → `pixels / zoom`
- `viewStartTime` / `viewEndTime` — derived from scrollLeft + containerWidth + zoom

## Track Types

**CanvasTrack** — continuous data (VAD, energy, diarization, mouth energy). Draw callback receives `(ctx, width, height, viewport)`. Uses RAF loop when playing/scrubbing. Handles DPR scaling.

**DOMTrack** — discrete blocks (transcription, states, intents). Generic `<T>` with `getStart`/`getEnd`/`blockClass`/`blockLabel` props. Viewport-culled via binary search (`utils/binary-search.ts`). Blocks are absolutely-positioned `<button>` elements with `will-change: transform`.

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

Custom properties in `viewer.css` (`.viewer-theme`): `--viewer-bg`, `--viewer-surface`, `--viewer-accent`, `--viewer-playhead`, etc. Block colors: `.block-speaker-0` (cyan), `.block-speaker-1` (pink), `.block-speaking` (green), `.block-listening` (slate), `.block-intent-*` (one per intent type).
