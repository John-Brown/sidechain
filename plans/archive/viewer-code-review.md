# Viewer / Timeline Page — Code Review

**Date**: 2026-02-08
**Status**: All 20 fixes implemented — commit `f1740ef`
**Scope**: `apps/web/src/lib/components/viewer/` + supporting routes, tRPC routers, caching layers
**Methodology**: 5-agent parallel review (state management, rendering/performance, editing, data flow, architecture/UX)

---

## Summary

The viewer is architecturally sound — the three-context system, class-based Svelte 5 state, viewport culling via binary search, and the 60fps drag protocol are all well-designed. The main risk areas are: **data loss paths** (concurrent saves, silent exit without save), **`$state` proxy leaks** into `structuredClone` calls, and **accessibility gaps** (no focus trapping, missing ARIA landmarks, Tab hijacking).

### Finding Counts

| Severity | Count |
|----------|-------|
| Critical (bugs / data loss) | 9 |
| Concern (fragile / scaling) | 16 |
| Good patterns noted | 18 |

---

## Critical Issues

### Data Integrity

**C1. Concurrent autosave race can lose edit audit records**
`autosave.svelte.ts:106-161` — `saveNow()` has no re-entrancy guard. The 30s debounce timer can fire while a manual Ctrl+S save is in-flight. Both calls `getAndClearEdits()` (destructive drain), so the second save sends empty edits. Dirty flags can be cleared prematurely.
**Fix**: Add `#saving` boolean or promise-chain mutex.

**C2. Exiting edit mode discards unsaved changes silently**
`AnnotationViewer.svelte:291-312` — `toggleEditMode()` calls `editor.exitEditMode()` without checking `editor.hasChanges`. Dirty edits are lost without warning.
**Fix**: Check `hasChanges`; either auto-save first or prompt confirmation.

**C3. Draft restore overwrites newer server data**
`AnnotationViewer.svelte:620-629` — `restoreDraft()` blindly replaces editor arrays from localStorage without comparing timestamps against the DB version. A stale draft can revert supervisor-approved edits.
**Fix**: Store annotation set `createdAt` in draft; compare before offering restore.

### Svelte 5 Proxy / Clone

**C4. `History.undo()`/`redo()` calls `structuredClone` on `$state` proxies**
`history.svelte.ts:42,49` — `structuredClone(currentState)` where `currentState` is a `$state` proxy. Works today because annotation data is plain primitives, but will throw `DataCloneError` if data ever contains Maps, Sets, or class instances.
**Fix**: Accept pre-snapshotted values, or call `$state.snapshot()` internally.

**C5. `operations.ts` functions clone proxy-wrapped items**
`resizeAnnotation`, `splitAnnotation`, `mergeAnnotations`, `classifyAnnotation` all call `structuredClone(items[index])` where items may be `$state`-proxied. Latent bug — not all code paths are exercised today but will break when called with proxied data.
**Fix**: Wrap with `$state.snapshot()` at function entry, or document that callers must pass plain data.

### Rendering

**C6. Wheel zoom handler is passive — `preventDefault()` silently ignored**
`AnnotationViewer.svelte:1174` — Svelte 5 declarative `onwheel` defaults to passive in modern browsers. `e.preventDefault()` on Cmd+wheel for zoom is silently ignored, causing simultaneous zoom + scroll.
**Fix**: Attach imperatively in `onMount` with `{ passive: false }`.

**C7. `matchMedia` dark theme listener never cleaned up**
`AnnotationViewer.svelte:111-113` — `addEventListener('change', ...)` at module scope, never removed. Leaks on component remount.
**Fix**: Move to `onMount` with cleanup return.

### Editing Logic

**C8. `checkOverlap` only checks adjacent items — move can bypass**
`time-validation.ts:17-27` — Neighbor-only overlap check is correct for resize but insufficient for move. A long-distance move could place a block out-of-order without detection.
**Fix**: After move, validate full sort order, or check all items (n is small for visible annotations).

### Accessibility

**C9. No focus trapping in any modal dialog**
`LabelTextDialog`, `ClassifyDialog`, `TaskSubmitDialog`, `KeyboardShortcutsHelp` — users can Tab out of modals into the background page. None return focus to the trigger element on close.
**Fix**: Use bits-ui focus trap (already a dependency) or implement a shared utility.

---

## Concerns

### State Management

**S1. Autosave `$effect` only fires once per edit session**
`AnnotationViewer.svelte:611-617` — Watches `editor.hasChanges` (boolean). Once `true`, subsequent `markDirty()` calls for different types don't re-trigger. localStorage draft may miss the second type's changes. Server save is fine (reads dirty types at save time).

**S2. `#pendingEdits` intentionally non-reactive but undocumented**
`editor.svelte.ts:49` — Could confuse future contributors who try to derive UI from it.

**S3. `loadStatus` mutation pattern is inconsistent**
Mixed proxy mutation and spread-reassign in `AnnotationViewer.svelte:932-941`. Works but muddled intent.

**S4. `TimelineState` uses getters instead of `$derived`**
`timeline.svelte.ts:13-28` — No memoization on computed values. Cheap arithmetic, so low impact.

### Performance

**P1. DOMTrack/EditableDOMTrack O(n) wrapping on every viewport change**
`DOMTrack.svelte:24-27`, `EditableDOMTrack.svelte:71-77` — `data.map(...)` creates wrapper objects for binary search on every scroll/zoom. Matters at 10K+ items.
**Fix**: Accessor-based binary search variants, or memoize wrapped array keyed on `data` identity.

**P2. Canvas `getContext('2d')` called on every frame**
`CanvasTrack.svelte:28` — Browsers cache it, but unnecessary call overhead at 300+/sec across tracks.

**P3. Ruler iterates full duration, not just visible range**
`draw-functions.ts:44-47` — O(duration) loop where O(visible_ticks) suffices.

**P4. S3 server-side cache has no size bound**
`s3-cache.ts` — Map grows unboundedly. Each result is 100s of KB.

### Data Flow

**D1. No `beforeunload` save**
Up to 30s of edits lost if tab closes between debounce fires. Draft in localStorage partially mitigates.

**D2. tRPC/Supabase client re-created per viewer mount**
`AnnotationViewer.svelte:122-126` — Should be lifted to module/layout level.

**D3. Polling cleanup guard is inside wrong conditional**
`AnnotationViewer.svelte:703-722` — `pollTimer` cleanup is nested inside `if (timelineContainerEl)`.

### Editing

**E1. `EditorState` undo is per-type, not global**
No way to undo across track types without reselecting. Standard timeline editors use global undo.

**E2. `History.push` double-clones**
Callers clone before passing, then `push()` clones again. ~2x memory overhead per snapshot.

**E3. No tests for `drag-resize.ts`**
`computeDragPreview`, `computeFinalRange`, `validateResize` are pure functions with zero coverage.

**E4. No tests for `operations.ts` edge cases**
Empty arrays, invalid indices — would crash on undefined access.

**E5. `ClassifyDialog` Escape doesn't stopPropagation**
Unlike `LabelTextDialog` (capture + stopPropagation), ClassifyDialog lets Escape bubble to global handler.

### Architecture / UX

**A1. AnnotationViewer.svelte is 1332 lines — god component**
Handles state init, data loading, polling, waveform, caching, edit ops, draft recovery, task mode, keyboard, scroll, zoom, dialogs, autosave. Should extract data loading (~200 lines) and edit operations (~150 lines).

**A2. `pushUndoForType` duplicated between AnnotationViewer and CreateAnnotationBar**
Identical logic copy-pasted.

**A3. Tab key hijacked in edit mode**
`AnnotationViewer.svelte:566-570` — Breaks standard browser Tab navigation. Keyboard-only users can't reach header buttons.

**A4. No visible focus indicators on header buttons**
`ViewerHeader.svelte` — Hover styles present, no `focus-visible` styles. Default ring invisible on dark background.

**A5. N key does nothing in edit mode despite comment claiming otherwise**
`AnnotationViewer.svelte:511-516` — Comment says "In edit mode, N creates annotation" but CreateAnnotationBar has no N handler.

**A6. `TaskSubmitDialog` has no Escape handler**
Only dialog without keyboard dismiss. Inconsistent with others.

**A7. DraftRecoveryBanner has hardcoded light-unfriendly colors**
Absolute Tailwind amber values, not theme variables.

**A8. Missing ARIA landmarks on timeline**
No `role` or `aria-label` on timeline container, tracks, or label associations.

**A9. ContextMenu lacks arrow key navigation**
Has proper `role="menu"` / `role="menuitem"` but no arrow key support per WAI-ARIA.

---

## Good Patterns Worth Preserving

| # | Pattern | Location |
|---|---------|----------|
| G1 | Symbol-keyed contexts — collision-proof, type-safe | `context.ts` |
| G2 | 60fps drag protocol: setPointerCapture → rAF DOM mutation → commit on pointerup | `EditableDOMTrack.svelte` |
| G3 | `cancelAnimationFrame` before re-scheduling prevents frame doubling | `EditableDOMTrack.svelte:186` |
| G4 | 3px move threshold distinguishes click from drag | `EditableDOMTrack.svelte:62` |
| G5 | Binary search viewport culling on DOM tracks | `DOMTrack.svelte`, `EditableDOMTrack.svelte` |
| G6 | Canvas RAF loop conditional on `playing \|\| scrubbing` — no idle CPU | `CanvasTrack.svelte:36-37` |
| G7 | `will-change: transform` + `contain: layout style` on DOM blocks | track CSS |
| G8 | Versioned annotation saves in transaction | `annotations.ts:134-195` |
| G9 | S3 inflight deduplication prevents thundering herd | `s3-cache.ts:18-35` |
| G10 | Two-tier caching: IndexedDB (client) + in-memory (server) | `annotation-cache.ts` + `s3-cache.ts` |
| G11 | Server-side task constraint enforcement | `annotations.ts:58-87` |
| G12 | `$state.snapshot()` before `structuredClone` in enterEditMode | `AnnotationViewer.svelte` |
| G13 | History cap at 50 snapshots with `shift()` overflow | `history.svelte.ts` |
| G14 | Deep clone isolation in enterEditMode | `AnnotationViewer.svelte` |
| G15 | ResizeObserver cleanup in onMount return | `CanvasTrack.svelte`, `AnnotationViewer.svelte` |
| G16 | Playhead visibility check avoids off-screen DOM | `Playhead.svelte:12` |
| G17 | Auth flow: `getUser()` before `getSession()` | `hooks.server.ts` |
| G18 | Complete CSS theme system with light/dark variables | `viewer.css` |

---

## Prioritized Action Items

### P0 — Fix Now (data loss / real bugs)

1. **Autosave mutex** — Guard `saveNow()` against concurrent execution
2. **Confirm/save on edit mode exit** — Don't silently discard dirty edits
3. **Wheel handler passive fix** — Imperative listener with `{ passive: false }`
4. **`matchMedia` listener cleanup** — Move to `onMount` with teardown

### P1 — Fix Soon (latent bugs / correctness)

5. **`$state.snapshot()` in History.undo/redo** — Prevent future `DataCloneError`
6. **`$state.snapshot()` in operations.ts** — Same proxy pitfall
7. **`checkOverlap` for move operations** — Validate full ordering after move
8. **Draft freshness validation** — Compare timestamps before restore
9. **Focus trapping in dialogs** — Use bits-ui or shared utility

### P2 — Improve (quality / scaling / DX)

10. **Extract data loading from AnnotationViewer** — Reduce god component
11. **Deduplicate `pushUndoForType`** — Single shared function
12. **Add `drag-resize.ts` tests** — Pure functions, easy wins
13. **Add `operations.ts` edge case tests** — Empty/invalid inputs
14. **Accessor-based binary search** — Eliminate O(n) wrapping
15. **`beforeunload` save handler** — Minimize data loss window
16. **Focus-visible styles on header** — Keyboard accessibility
17. **Add ARIA landmarks to timeline** — Screen reader navigation
18. **Escape handler on TaskSubmitDialog** — Consistency
19. **Fix ClassifyDialog Escape propagation** — Match LabelTextDialog pattern
20. **DraftRecoveryBanner theme colors** — Use viewer CSS variables
