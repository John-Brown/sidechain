---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
---

# Testing

## Framework

Vitest for all TypeScript tests. No Jest.

- Config: `apps/web/vitest.config.ts` — globals enabled, node environment, `$lib` alias, `@sveltejs/vite-plugin-svelte` for `.svelte.ts` rune module compilation
- Run: `pnpm --filter web test` (CI) or `pnpm --filter web test:watch` (dev)

## Test Organization

- Unit tests co-located next to source files (e.g., `binary-search.ts` → `binary-search.test.ts`)
- Integration tests for tRPC routers: DB round-trip with test transactions
- No E2E framework yet — manual verification for UI interactions

## Minimum Test Rule

**Every new module with pure logic MUST have a co-located test file.** This applies to:

- Utility functions (`utils/*.ts`) — test all exported functions, edge cases, boundary conditions
- State classes (`.svelte.ts`) — test via direct instantiation, verify derived values and methods
- Pure operations (`editing/operations.ts`, validation, transforms) — test immutability, return shapes, edge cases
- DAG/pipeline logic — test resolution, key construction, gating
- tRPC routers with business logic — test via `createCaller` with mocked context

**What doesn't need tests:**
- Type-only files (interfaces, enums) — TypeScript compiler validates these
- Thin wrappers around external APIs (S3 client init, Supabase client init)
- Svelte components (`.svelte`) — no component test framework; verify via manual testing
- Canvas draw functions — high mock cost, low regression value; verify visually

**Test pattern:**
```ts
import { describe, it, expect } from 'vitest';
import { myFunction } from './my-module.js';

describe('myFunction', () => {
  it('does the expected thing', () => {
    expect(myFunction(input)).toBe(expected);
  });
  // Edge cases: empty input, boundary values, error paths
});
```

**For upcoming modules:** Create the test file with `it.todo()` stubs when scaffolding the source file. Fill in tests as you implement. This prevents test debt from accumulating.

## Existing Test Coverage

382 tests across 18 files, all passing as of 2026-09-24 after the design pass (`pnpm --filter web test`).

| File | Tests | Covers |
|------|-------|--------|
| `viewer/review.test.ts` | 42 | LOW_CONFIDENCE, item introspection, provenance stamps, isLowConfidence, buildReviewQueue, ⇥ navigation, review progress, findOverlaps, locked ranges untouched, task checklist |
| `viewer/editing/time-validation.test.ts` | 40 | Overlap, bounds, min duration (50ms), locked regions, coverage |
| `viewer/editing/drag-resize.test.ts` | 39 | Resize/move math, snapping, clamping |
| `viewer/state/editor.test.ts` | 35 | EditorState enter/exit edit, dirty tracking, selection, undo/redo (incl. clearing a stale selection), confirm |
| `viewer/utils/binary-search.test.ts` | 32 | Viewport culling binary search: time_range + time-only items, edges, padding |
| `viewer/editing/operations.test.ts` | 31 | create, delete, split, merge, classify (immutability, return shapes) |
| `viewer/state/tracks.test.ts` | 30 | Track layout: per-mode defaults, clampHeight, applyPersisted, collapse, setHeight, move/reorder, visibleTracks, persistence (view and edit share a layout) |
| `viewer/mesh-overlay.test.ts` | 21 | Keyframe depth interpolation: nearest-frame lookup, lerp between bracketing keyframes, clamping, exact hits, immutability |
| `server/pipeline/dag.test.ts` | 20 | getReadyStages, buildS3KeysIn, ROOT_STAGES, in-dev gating, dep consistency |
| `viewer/fixtures/generate.test.ts` | 18 | Dev fixture: determinism, result shapes vs `@annotation/shared`, state contiguity, the 42–72s review window, low-confidence coverage, task mode |
| `viewer/state/history.test.ts` | 15 | History<T>: push, undo, redo, overflow ordering, default max 50, branch truncation, roundtrips, deep clone, clear |
| `viewer/utils/format-time.test.ts` | 13 | formatTime + formatTimePrecise, edge cases |
| `viewer/utils/group-words.test.ts` | 12 | Transcription LOD phrase grouping: segment merge/transition, undefined speech_segment, majority speaker, 80-char truncation, immutability |
| `viewer/state/timeline.test.ts` | 9 | Viewport math, clamping, fitZoom, roundtrips |
| `viewer/state/task-mode.test.ts` | 8 | reviewScopeFor, overlapTracksFor, TaskModeState review counters |
| `viewer/utils/annotation-cache.test.ts` | 7 | IndexedDB annotation cache lifecycle |
| `server/s3-cache.test.ts` | 7 | In-memory S3 getter cache, TTL, dedup |
| `viewer/tracks/draw-functions.test.ts` | 3 | `rulerSteps` (ruler tick spacing); the draw functions themselves are verified visually |

## Remaining Test Priorities

Not yet written:

| File | Coverage |
|------|----------|
| `annotations.router.test.ts` | save (version increment, is_current flag), revert, audit trail in annotation_edits |
| `tasks.router.test.ts` | lifecycle transitions, constraint enforcement, pipeline trigger on approval |

## Conventions

- Pure functions (operations.ts, time-validation.ts) get thorough unit tests — easy to test, high value
- State classes tested via direct instantiation (no component mounting needed)
- `.svelte.ts` imports work in tests thanks to the svelte vite plugin in vitest config
- tRPC routers tested via `createCaller` with mocked context
- Test names: describe the behavior, not the implementation
- Use `vi.fn()` for mocks — no heavy mock libraries
