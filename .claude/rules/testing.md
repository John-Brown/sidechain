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

| File | Tests | Covers |
|------|-------|--------|
| `viewer/utils/binary-search.test.ts` | 21 | Viewport culling binary search — time_range + time-only items, edges, padding |
| `viewer/utils/format-time.test.ts` | 13 | formatTime + formatTimePrecise, edge cases |
| `server/pipeline/dag.test.ts` | 20 | getReadyStages, buildS3KeysIn, ROOT_STAGES, in-dev gating, dep consistency |
| `viewer/state/timeline.test.ts` | 9 | Viewport math, clamping, fitZoom, roundtrips |
| `viewer/utils/annotation-cache.test.ts` | 7 | IndexedDB annotation cache lifecycle |
| `viewer/utils/waveform-cache.test.ts` | 7 | IndexedDB waveform cache lifecycle |
| `server/s3-cache.test.ts` | 7 | In-memory S3 getter cache, TTL, dedup |

## Phase 4 Test Priorities

Stub files already exist in `viewer/editing/` — fill in as modules are implemented:

| File | Coverage |
|------|----------|
| `history.test.ts` | push, undo, redo, overflow (>50), branch truncation on new push after undo |
| `time-validation.test.ts` | overlap detection, bounds check, min duration (50ms), locked region enforcement, coverage validation |
| `operations.test.ts` | create, delete, split, merge, classify — verify returned arrays are valid, original unchanged |
| `annotations.router.test.ts` | save (version increment, is_current flag), revert, audit trail in annotation_edits |
| `tasks.router.test.ts` | lifecycle transitions, constraint enforcement, pipeline trigger on approval |

## Conventions

- Pure functions (operations.ts, time-validation.ts) get thorough unit tests — easy to test, high value
- State classes tested via direct instantiation (no component mounting needed)
- `.svelte.ts` imports work in tests thanks to the svelte vite plugin in vitest config
- tRPC routers tested via `createCaller` with mocked context
- Test names: describe the behavior, not the implementation
- Use `vi.fn()` for mocks — no heavy mock libraries
