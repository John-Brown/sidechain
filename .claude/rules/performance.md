---
paths:
  - "apps/web/src/lib/components/viewer/**"
---

# Performance Constraints

## Hard Targets

| Metric | Target | Approach |
|--------|--------|----------|
| Drag frame time | p95 < 8ms | Inline style only during drag — zero Svelte reactivity until pointerup |
| Undo/redo | < 5ms | structuredClone of ~100KB arrays |
| Viewport cull | < 2ms for 10K items | Binary search, not filter |
| Auto-save round-trip | < 500ms | Single JSONB upsert per type |

## Critical Rules

- **During drag**: mutate ONLY `element.style.transform` / `element.style.width` via rAF. No `$state` writes, no store updates, no reactive re-renders.
- **Commit on pointerup only**: compute final values, validate, then write to editorState + push undo snapshot.
- **Viewport culling is mandatory** for all DOM tracks, and for canvas draw functions that iterate items (`drawVad`, `drawDiarization`). Use binary search from `utils/binary-search.ts`. Never render or draw all items.
- **Track resize and reorder** drag a transform-positioned guide (TrackLabel) and commit height/order to `TrackLayoutState` on pointerup/drop only, so no row reflows mid-drag.
- **No transitions or shadows on blocks** (`.blk { transition: none }`); the static inset ink cap on human blocks is the one shadow. Motion elsewhere is 150–200ms color/border only.
- **Canvas redraw cost scales with the viewport**: CanvasTrack's canvas is viewport-sized (translated by scrollLeft) and redraws from an `$effect`, with no per-frame loop. TimelineOverview renders its data layer once to an offscreen canvas and only blits it + draws the window and playhead per frame.
- **Large read-only series stay out of deep proxies**: a draw function must not copy or walk a whole deep-`$state` array per redraw, because every proxied read costs time and registers a dependency. `annotations.waveform` is `$state.raw`, and its peak `Float32Array`s are built once per load in a `$derived` (`waveformPeaks`). Measured on `/dev/viewer`: 60 scroll frames took 157 ms of script with frame p95 at about 18 ms (vsync), down from about 2.3 s and a 50 ms p95 when each redraw copied the peaks.
- **`will-change: transform`** on draggable elements. **`contain: layout style`** on block containers.
- **Pointer capture** via `setPointerCapture` — prevents drag from escaping element boundaries.
- **structuredClone** for undo snapshots — built-in, fast for <1MB payloads. No library needed.
- **No DnD libraries** — the interactions are timeline-specific (time-to-pixel conversion). Generic DnD adds overhead without value.
