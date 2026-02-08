---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
---

# Testing

## Framework

Vitest for all TypeScript tests. No Jest.

## Test Organization

- Unit tests co-located or in parallel `__tests__` dirs
- Integration tests for tRPC routers: DB round-trip with test transactions
- No E2E framework yet — manual verification for UI interactions

## Phase 4 Test Priorities

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
- tRPC routers tested via `createCaller` with mocked context
- Test names: describe the behavior, not the implementation
