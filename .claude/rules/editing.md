---
paths:
  - "apps/web/src/lib/components/viewer/**"
---

# Phase 4: Editing + Task Mode Conventions

Reference plan: `plans/phase-4-editing-task-mode.md`

## Editor State Architecture

`editorState` (mutable) is a separate layer over `annotationDataState` (immutable/read-only):
- On entering edit mode: `structuredClone` editable arrays from annotationDataState into editorState
- DOM tracks read from editorState in edit mode, annotationDataState in view mode
- Canvas tracks always read annotationDataState (never editable)
- Dirty tracking per annotation type; diff against original to detect changes

## Editable vs Read-Only

| Editable (DOM, editorState) | Read-Only (Canvas, annotationDataState) |
|-----------------------------|----------------------------------------|
| states, intents, transcription, backchannels | VAD, energy, diarization, mouth energy, facial tracking |

## Undo/Redo

Snapshot-based via `structuredClone`. Push on `pointerup` (drag commit), create, delete, split, merge, classify — NOT during drag. Max 50 snapshots (~5MB). Generic `createHistory<T>()` in `state/history.svelte.ts`.

## Drag-to-Resize (60fps)

1. `pointerdown` on handle → `setPointerCapture`, record original time_range
2. `pointermove` → `requestAnimationFrame` → update ONLY inline `style.transform`/`style.width` — NO store mutation, NO reactivity
3. `pointerup` → compute final time, validate, commit to editorState, push undo snapshot

During drag: zero Svelte reactivity. One DOM mutation per frame on `will-change: transform` element.

## Validation Rules

- `end - start >= 0.05` (50ms minimum)
- No overlap with adjacent same-type annotations
- `start >= 0`, `end <= duration`
- Task mode: cannot extend into locked time ranges
- States must be contiguous (no gaps) — enforced on submit, warned on save
- Delete on states: adjacent block must absorb the gap

## Operations (Pure Functions)

All in `editing/operations.ts`. Signature: `(items: T[], index: number, ...args) → T[]`.

**IMPORTANT**: Operations are called via the **command executor**, not directly from UI handlers. See `ai-first.md` for the command layer architecture. UI handlers produce `AnnotationCommand` objects; the executor resolves targets, calls operations, pushes undo, and sets dirty flags.

## Auto-Save

- `$effect` watches dirty state → immediate localStorage backup → 30s debounce → tRPC `annotations.save`
- localStorage key: `draft:{videoId}`
- On load: check for draft newer than DB version, offer restore
- Save indicator states: `idle` → `saving` → `saved` (2s) → `idle`. On error: `error` with retry.

## Field Mutability

| Type | Mutable | Immutable (AI provenance) |
|------|---------|--------------------------|
| StateAnnotation | time_range, category | note, parameters |
| IntentAnnotation | time_range, intent, intensity, valence | confidence, reasoning |
| SpeechWord | time_range, speaker | word, confidence, speech_segment |

## Task Mode

Activated via `?taskId=xxx` query param. TaskConstraints JSONB defines: `editableTypes`, `allowedCategories`, `lockedTimeRanges`, `allowedOperations`. Enforced at UI level (disable handles/buttons) AND server-side (tRPC validates constraints before writing).

## Task Lifecycle

`pending` → `assigned` → `in_progress` → `submitted` → `approved`/`rejected`
- Pipeline triggers on **approved** (not submitted) — supervisor gate
- On approval: export annotation_sets.data to S3 at `results/{videoId}/{type}_approved.json`, then trigger downstream DAG stages
