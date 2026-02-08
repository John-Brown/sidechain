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
- **Viewport culling is mandatory** for all DOM tracks. Use binary search from `utils/binary-search.ts`. Never render all blocks.
- **`will-change: transform`** on draggable elements. **`contain: layout style`** on block containers.
- **Pointer capture** via `setPointerCapture` — prevents drag from escaping element boundaries.
- **structuredClone** for undo snapshots — built-in, fast for <1MB payloads. No library needed.
- **No DnD libraries** — the interactions are timeline-specific (time-to-pixel conversion). Generic DnD adds overhead without value.
