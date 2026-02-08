# Phase 4: Annotation Editing + Task Mode

## Context

Phase 3 delivered a performant read-only annotation viewer: multi-track timeline with Canvas (VAD, energy, diarization, mouth energy) and DOM tracks (transcription, states, intents), viewport culling, playhead sync, zoom, scrub, and keyboard shortcuts. All data flows one-way from S3 → viewer with no editing capability.

Phase 4 transforms the viewer into a full annotation editor. AI proposes, humans correct. The editing layer must handle drag-to-resize at 60fps, undo/redo, auto-save, and constrained Task Mode for crowdsourced annotation.

**Deliverable**: Full human-in-the-loop workflow — annotators can resize, create, delete, split, merge, and classify annotations. Task Mode constrains editing to assigned stages. Submission triggers downstream pipeline stages.

---

## 1. Architecture Decisions

### 1.1 Editing State: Mutable Layer Over Read-Only Data

The existing `annotationDataState` holds raw pipeline results (S3 JSON). Editing needs a separate **mutable editing store** that:
- Clones editable annotation arrays (states, intents, backchannels) from pipeline results on load
- Tracks dirty state per annotation type
- Is the single source of truth for DOM track rendering during editing
- Leaves read-only data (VAD, energy, diarization, mouth energy, facial tracking) untouched

```
S3 pipeline results ──→ annotationDataState (read-only, immutable)
                              │
                              ├──→ Canvas tracks (read directly)
                              │
                              └──→ editorState (mutable clones of editable types)
                                    │
                                    ├──→ DOM tracks (render from here)
                                    ├──→ Undo/redo history
                                    ├──→ Auto-save (debounced → tRPC → DB)
                                    └──→ Dirty tracking
```

**Why not edit annotationDataState directly?** Separation lets us diff against the original to detect changes, revert to AI output, and avoid polluting the polling/loading path with edit state.

### 1.2 Undo/Redo: Snapshot-Based History

Snapshot-based undo with `structuredClone`. Simpler than command pattern, handles all edit types uniformly, and works naturally with Svelte 5 `$state`.

```typescript
function createHistory<T>(initial: T, maxDepth = 50) {
  let history = $state<T[]>([structuredClone(initial)]);
  let index = $state(0);
  const current = $derived(history[index]);
  const canUndo = $derived(index > 0);
  const canRedo = $derived(index < history.length - 1);

  function push(snapshot: T) {
    history = [...history.slice(0, index + 1), structuredClone(snapshot)];
    if (history.length > maxDepth) { history.shift(); index--; }
    index = history.length - 1;
  }

  function undo() { if (canUndo) index--; }
  function redo() { if (canRedo) index++; }

  return { get current() { return current; }, canUndo, canRedo, push, undo, redo };
}
```

Snapshots are pushed on `pointerup` (end of drag), classify, create, delete, split, merge. During drag, only inline styles change — no snapshot until commit.

**Memory**: ~50 snapshots of annotation arrays (typically <1000 items, ~100KB each) = ~5MB. Acceptable.

### 1.3 Drag-to-Resize: Pointer Capture + rAF

Phase 0 architecture's strategy, validated by the spike:

1. `pointerdown` on resize handle → `setPointerCapture`, enter drag mode, record original time_range
2. `pointermove` → throttle via `requestAnimationFrame`, update ONLY the dragged element's inline `style.transform`/`style.width` — **no store update, no reactivity, no re-render**
3. `pointerup` → compute final time from pixel position, validate (no overlaps, within bounds), commit to editorState, push undo snapshot

During drag: exactly one DOM mutation per frame on a `will-change: transform` element. No Svelte reactivity fires until commit.

### 1.4 Auto-Save: Debounced $effect + localStorage Draft

```
User edit → editorState mutation → push undo snapshot
                                       │
                                       ├──→ $effect detects dirty → 30s debounce timer
                                       │        └──→ tRPC annotations.save mutation
                                       │              └──→ Upsert annotation_sets row
                                       │                    └──→ Insert annotation_edits audit rows
                                       │
                                       └──→ localStorage.setItem('draft:{videoId}:{type}', JSON.stringify)
                                              (immediate, on every push — crash recovery)
```

Save indicator states: `idle` → `saving` → `saved` (2s) → `idle`. On error: `error` with retry.

localStorage draft cleared on successful DB save. On viewer load, check for draft and offer restore if newer than DB version.

### 1.5 Task Mode: Constraint System

Tasks constrain what an annotator can edit. Constraints defined in `tasks.constraints` JSONB:

```typescript
interface TaskConstraints {
  editableTypes: AnnotationSetType[];      // Which annotation types can be modified
  allowedCategories?: string[];            // Restrict category palette (e.g., only speaking/listening)
  lockedTimeRanges?: TimeRange[];          // Regions that cannot be edited (session exclusions)
  allowedOperations?: EditType[];          // Subset of create/resize/delete/split/merge/classify
}
```

Task Mode enforces at two levels:
- **UI**: Disable handles/buttons/menus for locked regions and disallowed operations
- **API**: tRPC mutations validate constraints server-side before writing

### 1.6 Human-in-the-Loop Pipeline Pauses

When a task is submitted (`status: submitted`), the callback handler checks if downstream stages can now advance:

```
Annotator submits task (verify_states)
  → tRPC tasks.submit mutation
    → Update task.status = 'submitted'
    → Check: are all verify_states tasks for this video submitted?
      → If yes: trigger intent_classification stage via DAG
      → If no: wait for remaining tasks
```

The DAG resolver gains a new check: human validation stages must have all associated tasks in `submitted`/`approved` status before downstream stages fire.

### 1.7 No New Dependencies

All editing infrastructure is custom — no drag-and-drop library needed. The interactions are too specific (timeline-aware pointer capture with time-to-pixel conversion) for generic DnD libraries to add value. `structuredClone` for undo (built-in). `requestAnimationFrame` for drag throttling (built-in).

---

## 2. Implementation Waves

### Wave 1: Editor State + Undo/Redo Foundation

**Goal**: Mutable editing layer exists, undo/redo works, editorState drives DOM track rendering.

#### New Files

| File | Purpose |
|------|---------|
| `viewer/state/editor.svelte.ts` | `createEditorState()` — mutable clones of editable annotations, dirty tracking, mode (view/edit) |
| `viewer/state/history.svelte.ts` | `createHistory<T>()` — generic snapshot-based undo/redo with Svelte 5 runes |

#### Changes

| File | Changes |
|------|---------|
| `viewer/AnnotationViewer.svelte` | Create + provide editorState via context; toggle edit mode; wire Ctrl+Z / Ctrl+Shift+Z |
| `viewer/context.ts` | Add `setEditorState()` / `getEditorState()` context pair |
| `viewer/ViewerHeader.svelte` | Edit mode toggle button; undo/redo buttons with canUndo/canRedo state |

#### `createEditorState()` Shape

```typescript
interface EditorState {
  mode: 'view' | 'edit';
  states: StateAnnotation[];          // Mutable clone
  intents: IntentAnnotation[];        // Mutable clone
  backchannels: BackchannelAnnotation[]; // Mutable clone (empty until Phase 7 backchannels)
  transcription: SpeechWord[];        // Mutable clone (word boundary edits)
  selectedIndex: number | null;       // Currently selected annotation index
  selectedType: AnnotationSetType | null;
  dirty: Record<AnnotationSetType, boolean>;
  history: History<EditableSnapshot>;
}

interface EditableSnapshot {
  states: StateAnnotation[];
  intents: IntentAnnotation[];
  backchannels: BackchannelAnnotation[];
  transcription: SpeechWord[];
}
```

On entering edit mode: `structuredClone` the relevant arrays from `annotationDataState` into `editorState`. DOM tracks switch from reading `annotationDataState` to `editorState`.

---

### Wave 2: Drag-to-Resize on DOM Tracks

**Goal**: State and intent annotation blocks can be resized by dragging edges. Word blocks can be resized. Resize handle UI, pointer capture, 60fps inline style updates, validation, commit.

#### New Files

| File | Purpose |
|------|---------|
| `viewer/tracks/EditableDOMTrack.svelte` | Extended DOMTrack with resize handles, drag logic, selection highlight |
| `viewer/editing/drag-resize.ts` | Pointer capture logic, rAF throttling, time validation, overlap prevention |
| `viewer/editing/time-validation.ts` | `validateResize()`, `validateTimeRange()` — overlap check, bounds check, min duration (50ms) |

#### Interaction Design

**Block anatomy in edit mode:**
```
┌─────────────────────────────────────────────────┐
│◀ handle │          block body           │ handle ▶│
│  6px    │     (label, click=select)     │  6px    │
└─────────────────────────────────────────────────┘
```

- Resize handles: 6px wide hitboxes on left/right edges, `cursor: col-resize`
- Body click: select annotation → populate inspector with editable fields
- Body double-click: open classify dialog (for states/intents)
- Selected block: 2px highlight border + elevated z-index

**Drag-resize flow:**

```typescript
function handlePointerDown(e: PointerEvent, edge: 'left' | 'right', index: number) {
  e.currentTarget.setPointerCapture(e.pointerId);
  dragState = { edge, index, startX: e.clientX, originalRange: { ...item.time_range } };
}

function handlePointerMove(e: PointerEvent) {
  if (!dragState) return;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const deltaPixels = e.clientX - dragState.startX;
    const deltaTime = deltaPixels / timeline.zoom;
    // Update ONLY inline style — no store mutation
    updateDragPreview(dragState.edge, deltaTime);
  });
}

function handlePointerUp(e: PointerEvent) {
  if (!dragState) return;
  const newRange = computeFinalRange(dragState);
  if (validateResize(newRange, dragState.index, editorState)) {
    commitResize(dragState.index, newRange);  // → mutate editorState, push undo
  } else {
    revertDragPreview();  // Snap back to original
  }
  dragState = null;
}
```

**Validation rules:**
- `end - start >= 0.05` (50ms minimum duration)
- No overlap with adjacent annotations of the same type
- `start >= 0` and `end <= duration`
- In Task Mode: cannot extend into locked time ranges

---

### Wave 3: Create, Delete, Split, Merge, Classify

**Goal**: Full annotation CRUD. Context menu on right-click. Classify dialog.

#### New Files

| File | Purpose |
|------|---------|
| `viewer/editing/operations.ts` | `createAnnotation()`, `deleteAnnotation()`, `splitAnnotation()`, `mergeAnnotations()`, `classifyAnnotation()` — pure functions that return new arrays |
| `viewer/components/ContextMenu.svelte` | Right-click menu: Delete, Split at playhead, Merge with adjacent |
| `viewer/components/ClassifyDialog.svelte` | Category picker: states (speaking/listening), intents (6 types × 3 intensities × 3 valences) |
| `viewer/components/CreateAnnotationBar.svelte` | "Add annotation" toolbar shown in edit mode — click to create at playhead position with default duration |

#### Operations

| Operation | Trigger | Behavior |
|-----------|---------|----------|
| **Create** | Toolbar button or `N` key | Insert new annotation at playhead position, 1s default duration, default category. Prevent overlap. |
| **Delete** | Context menu or `Delete`/`Backspace` key | Remove selected annotation. Push undo snapshot. |
| **Split** | Context menu or `S` key | Split selected annotation at playhead position into two. Both halves keep original category. |
| **Merge** | Context menu (when adjacent selected) or `M` key | Merge selected annotation with adjacent same-category block. Union time range. |
| **Classify** | Double-click or `C` key | Open ClassifyDialog for selected annotation. Update category/intent fields. |

All operations are pure functions: `(annotations: T[], index: number, ...args) → T[]`. Editor calls them, assigns result to editorState array, pushes undo snapshot.

---

### Wave 4: Auto-Save + Persistence Backend

**Goal**: Edits persist to DB via tRPC. Auto-save on 30s debounce. Audit trail in annotation_edits. localStorage crash recovery.

#### New Files

| File | Purpose |
|------|---------|
| `trpc/routers/annotations.ts` | Annotation CRUD: `save`, `get`, `getVersion`, `listVersions`, `revert` |
| `trpc/routers/tasks.ts` | Task lifecycle: `getAssigned`, `start`, `submit`, `review` (approve/reject) |
| `viewer/state/autosave.svelte.ts` | Auto-save logic: $effect watching dirty state, 30s debounce, localStorage draft, save indicator |
| `viewer/components/SaveIndicator.svelte` | Shows saved/saving/error in header |
| `viewer/components/DraftRecoveryBanner.svelte` | "Unsaved draft found" banner on viewer load |

#### `annotations` tRPC Router

```typescript
annotations: {
  // Save current edits — creates new version of annotation_set
  save: protectedProcedure
    .input(z.object({
      videoId: z.string().uuid(),
      type: z.enum(ANNOTATION_SET_TYPES),
      data: z.unknown(),           // JSONB — validated per type
      edits: z.array(z.object({    // Batch of edits since last save
        editType: z.enum(EDIT_TYPES),
        targetIndex: z.number().int().nullable(),
        beforeState: z.unknown().nullable(),
        afterState: z.unknown().nullable(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.db.transaction(async (tx) => {
        // 1. Set is_current=false on existing current version
        // 2. Insert new annotation_set with is_current=true, version+1
        // 3. Batch insert annotation_edits
        // 4. Return new version info
      });
    }),

  // Get current version for a video+type
  get: protectedProcedure.input(...).query(...),

  // List version history
  listVersions: protectedProcedure.input(...).query(...),

  // Revert to specific version
  revert: protectedProcedure.input(...).mutation(...),
}
```

#### `tasks` tRPC Router

```typescript
tasks: {
  // Get tasks assigned to current user
  getAssigned: protectedProcedure.query(...),

  // Get task for specific video (viewer context)
  getForVideo: protectedProcedure.input(z.object({
    videoId: z.string().uuid(),
  })).query(...),

  // Start a task (status: assigned → in_progress)
  start: protectedProcedure.input(z.object({
    taskId: z.string().uuid(),
  })).mutation(...),

  // Submit for review (status: in_progress → submitted)
  submit: protectedProcedure.input(z.object({
    taskId: z.string().uuid(),
    editCount: z.number().int(),
    timeSpentSecs: z.number(),
  })).mutation(async ({ input, ctx }) => {
    // 1. Update task status
    // 2. Check if all tasks for this video+stage are submitted
    // 3. If yes, trigger downstream pipeline stages via DAG
  }),

  // Supervisor: approve/reject
  review: protectedProcedure.input(z.object({
    taskId: z.string().uuid(),
    result: z.enum(['approved', 'rejected']),
    notes: z.string().optional(),
  })).mutation(...),
}
```

#### Auto-Save $effect

```typescript
$effect(() => {
  // Track dirty state — this runs whenever any editable array changes
  const isDirty = Object.values(editor.dirty).some(Boolean);
  if (!isDirty || editor.mode !== 'edit') return;

  // Immediate localStorage backup
  const draft = {
    states: editor.states,
    intents: editor.intents,
    backchannels: editor.backchannels,
    transcription: editor.transcription,
    savedAt: Date.now(),
  };
  localStorage.setItem(`draft:${videoId}`, JSON.stringify(draft));

  // Debounced DB save
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveStatus = 'saving';
    try {
      for (const type of dirtyTypes) {
        await trpc.annotations.save.mutate({ videoId, type, data: editor[type], edits: pendingEdits });
      }
      saveStatus = 'saved';
      editor.dirty = resetDirty();
      localStorage.removeItem(`draft:${videoId}`);
      setTimeout(() => { saveStatus = 'idle'; }, 2000);
    } catch {
      saveStatus = 'error';
    }
  }, 30_000);

  return () => clearTimeout(saveTimer);
});
```

---

### Wave 5: Task Mode + Pipeline Integration

**Goal**: Constrained editing for assigned tasks. Submit triggers downstream stages.

#### New Files

| File | Purpose |
|------|---------|
| `viewer/state/task-mode.svelte.ts` | `createTaskModeState()` — active task, constraints, time tracking |
| `viewer/components/TaskPanel.svelte` | Task info panel (replaces inspector in task mode): instructions, constraints, timer, submit button |
| `viewer/components/TaskSubmitDialog.svelte` | Confirmation dialog before submission |

#### Task Mode Behavior

When viewer loads with `?taskId=xxx` query param:

1. Fetch task via `trpc.tasks.getForVideo`
2. Parse `constraints` JSONB into `TaskConstraints`
3. Initialize `taskModeState`:
   - Start timer (`performance.now()` on mount)
   - Set editable types from constraints
   - Set locked time ranges from constraints
   - Set allowed categories
4. UI changes:
   - Non-editable tracks become fully non-interactive (no resize handles)
   - Locked time ranges show semi-transparent overlay
   - Category picker restricted to `allowedCategories`
   - Create button only available for allowed types
   - Submit button replaces save button
   - Timer visible in header

#### Pipeline Integration on Submit

When annotator clicks Submit:

```typescript
async function handleSubmit() {
  // 1. Force-save current edits
  await saveEdits();

  // 2. Submit task
  await trpc.tasks.submit.mutate({
    taskId: task.id,
    editCount: totalEdits,
    timeSpentSecs: elapsedSeconds(),
  });

  // Server-side: tasks.submit mutation checks DAG readiness
  // If all verify_states tasks for this video are submitted:
  //   → trigger intent_classification via triggerStage()
  // The existing callback handler chains from there
}
```

#### DAG Changes

`dag.ts` gains a `HUMAN_VALIDATION_STAGES` concept:

```typescript
// After these stages complete, a human task must be submitted
// before downstream stages can fire
export const HUMAN_GATES: Partial<Record<PipelineStage, TaskType>> = {
  state_annotation: 'verify_states',
  intent_classification: 'verify_intents',
};

// Extended readiness check:
// getReadyStages now also checks if upstream human gates have approved tasks
```

---

### Wave 6: Keyboard Shortcuts + Polish

**Goal**: Full keyboard-driven editing workflow. Visual polish for edit mode.

#### Editing Shortcuts

| Key | Action | Context |
|-----|--------|---------|
| `Ctrl+Z` / `Cmd+Z` | Undo | Edit mode |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo | Edit mode |
| `Ctrl+S` / `Cmd+S` | Force save | Edit mode |
| `Delete` / `Backspace` | Delete selected | Annotation selected |
| `N` | Create new annotation at playhead | Edit mode |
| `S` | Split selected at playhead | Annotation selected |
| `M` | Merge selected with adjacent | Annotation selected, adjacent exists |
| `C` | Open classify dialog | Annotation selected |
| `Escape` | Deselect / close dialog | Any |
| `Tab` | Select next annotation | Edit mode |
| `Shift+Tab` | Select previous annotation | Edit mode |

#### Visual Polish

- **Edit mode indicator**: Header background shifts to subtle amber tint
- **Resize handles**: Appear on hover with smooth opacity transition
- **Drag preview**: Semi-transparent ghost shows target position during drag
- **Selection**: Blue border + slight elevation on selected block
- **Locked regions**: Striped overlay pattern (CSS `repeating-linear-gradient`)
- **Dirty indicator**: Small dot on track label when unsaved edits exist

---

## 3. File Inventory

### New Files (16)

| File | Wave | Purpose |
|------|------|---------|
| `viewer/state/editor.svelte.ts` | 1 | Mutable editing state + dirty tracking |
| `viewer/state/history.svelte.ts` | 1 | Snapshot-based undo/redo |
| `viewer/tracks/EditableDOMTrack.svelte` | 2 | DOM track with resize handles + drag |
| `viewer/editing/drag-resize.ts` | 2 | Pointer capture, rAF, drag logic |
| `viewer/editing/time-validation.ts` | 2 | Overlap prevention, bounds checking |
| `viewer/editing/operations.ts` | 3 | Create, delete, split, merge, classify |
| `viewer/components/ContextMenu.svelte` | 3 | Right-click menu for edit operations |
| `viewer/components/ClassifyDialog.svelte` | 3 | Category picker for states/intents |
| `viewer/components/CreateAnnotationBar.svelte` | 3 | Toolbar for creating new annotations |
| `trpc/routers/annotations.ts` | 4 | Annotation CRUD + versioning |
| `trpc/routers/tasks.ts` | 4 | Task lifecycle management |
| `viewer/state/autosave.svelte.ts` | 4 | Auto-save logic + localStorage |
| `viewer/components/SaveIndicator.svelte` | 4 | Save status in header |
| `viewer/components/DraftRecoveryBanner.svelte` | 4 | Draft restore prompt |
| `viewer/state/task-mode.svelte.ts` | 5 | Task constraints + timer |
| `viewer/components/TaskPanel.svelte` | 5 | Task info + submit button |

### Modified Files (11)

| File | Wave | Changes |
|------|------|---------|
| `viewer/context.ts` | 1 | Add editor state context |
| `viewer/AnnotationViewer.svelte` | 1-5 | Editor init, mode toggle, keyboard shortcuts, task mode init |
| `viewer/ViewerHeader.svelte` | 1, 6 | Edit toggle, undo/redo, save indicator, task timer |
| `viewer/InspectorPanel.svelte` | 2 | Editable fields when annotation selected in edit mode |
| `viewer/viewer.css` | 2, 6 | Resize handles, selection, locked regions, edit mode styles |
| `trpc/router.ts` | 4 | Add annotations + tasks routers |
| `pipeline/dag.ts` | 5 | Human validation gate check |
| `pipeline/trigger.ts` | 5 | Support triggering from task submission |
| `packages/shared/src/annotation-types.ts` | 3 | Add `TaskConstraints` interface |
| `packages/shared/src/pipeline-types.ts` | 5 | Add `HUMAN_GATES` mapping |
| `routes/videos/[id]/viewer/+page.server.ts` | 5 | Pass taskId from URL query param |

---

## 4. Schema — No Migrations Needed

All tables exist from Phase 1:
- `annotation_sets` — versioned JSONB data with `is_current` flag ✓
- `annotation_edits` — audit trail with `edit_type`, `before_state`, `after_state` ✓
- `tasks` — task lifecycle with `constraints` JSONB, `time_spent_secs`, `edit_count` ✓

The schema was designed forward-looking. No DDL changes required.

---

## 5. Testing Strategy

### Unit Tests (Vitest)

| Test | Coverage |
|------|----------|
| `history.test.ts` | Undo/redo: push, undo, redo, overflow, branch truncation |
| `time-validation.test.ts` | Overlap detection, bounds checking, min duration, locked regions |
| `operations.test.ts` | Create, delete, split, merge, classify — all produce valid arrays |
| `drag-resize.test.ts` | Time-to-pixel, pixel-to-time, clamp, snap |
| `autosave.test.ts` | Debounce timing, dirty detection, localStorage round-trip |

### Integration Tests

| Test | Coverage |
|------|----------|
| `annotations.router.test.ts` | Save, versioning, revert — DB round-trip |
| `tasks.router.test.ts` | Lifecycle: assign → start → submit → review, pipeline trigger |

### Manual Verification

| Scenario | Steps |
|----------|-------|
| Resize a state block | Enter edit mode → drag right edge of state block → verify new time range committed, undo reverts |
| Create + delete | Create annotation at playhead → verify appears → delete → verify removed → undo → verify restored |
| Split at playhead | Select block → position playhead midway → press S → verify two blocks with correct time ranges |
| Auto-save | Edit → wait 30s → check DB has new version → close tab → reopen → verify draft recovery |
| Task Mode | Open viewer with taskId → verify only assigned type is editable → verify locked regions → submit → verify downstream stage triggers |

---

## 6. Performance Constraints

| Metric | Target | Strategy |
|--------|--------|----------|
| Drag frame time | p95 < 8ms | Inline style only during drag, no reactivity |
| Undo/redo latency | < 5ms | `structuredClone` of ~100KB arrays is <1ms |
| Viewport cull | < 2ms for 10K items | Binary search (existing) unchanged |
| Auto-save round-trip | < 500ms | Single JSONB write per type per save |
| localStorage write | < 10ms | `JSON.stringify` of editing snapshot |

---

## 7. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `structuredClone` perf on large annotation arrays | LOW | Arrays rarely exceed 1000 items (~100KB). Profile. If needed, switch to immer patches for large datasets. |
| Stale draft recovery conflicts | MEDIUM | Draft includes `savedAt` timestamp. Compare with DB `annotation_sets.created_at`. Show diff if ambiguous. |
| Task constraint enforcement bypass | MEDIUM | Server-side validation in `annotations.save` — verify user's task allows the edit type + annotation type + time range. |
| Concurrent editing (multiple tabs) | LOW | Not a Phase 4 concern (single user dev). Phase 5 adds optimistic locking via `annotation_sets.version`. |
| Pointer capture lost on iframe/modal | LOW | Use `gotpointercapture`/`lostpointercapture` events for recovery. |

---

## 8. What This Phase Does NOT Include

- **Multi-user real-time collaboration** — Phase 5
- **Supervisor review dashboard** — Phase 5
- **Inter-annotator agreement metrics** — Phase 5
- **Backchannel tagging UI** — deferred until pipeline stage is validated
- **Facial tracking Web Worker** — Phase 3 limitation, not blocking editing
- **Waveform audio track** — not in Phase 4 scope
- **Track show/hide toggles** — nice to have, not blocking

---

## 9. Wave Dependency Graph

```
Wave 1: Editor State + Undo/Redo
  │
  ├──→ Wave 2: Drag-to-Resize
  │       │
  │       └──→ Wave 3: Create/Delete/Split/Merge/Classify
  │               │
  │               └──→ Wave 4: Auto-Save + Persistence Backend
  │                       │
  │                       └──→ Wave 5: Task Mode + Pipeline Integration
  │                               │
  │                               └──→ Wave 6: Keyboard Shortcuts + Polish
  │
  (Wave 4 backend can start in parallel with Wave 2-3 frontend)
```

Waves 2-3 (frontend editing) and Wave 4 (backend persistence) can overlap — frontend editing works against local state while backend endpoints are built. They converge when auto-save wires tRPC mutations to editorState.

---

## 10. Reference Alignment Review

Cross-referenced against `reference/01-system-overview.md`, `reference/02-algorithm-reference.md`, `reference/03-data-flow.md`, and `reference/06-facial-tracking-reference.md`. Findings categorized by priority.

### 10.1 Decisions Required (HIGH)

#### A. Supervisor Gate vs Auto-Advance on Task Submission

**The problem**: The plan (§1.6) says task submission triggers downstream stages automatically. The reference implies supervisor review exists between submission and pipeline advance.

**Decision**: Two-track model.
- `verify_states` and `verify_intents` tasks require supervisor approval before downstream stages fire.
- The `tasks.submit` mutation sets status to `submitted`. A separate `tasks.review` mutation (supervisor only) sets `approved` or `rejected`.
- Pipeline trigger fires on `approved`, not `submitted`.
- If rejected, task returns to `in_progress` with supervisor notes. Annotator's edits are preserved.

```
Annotator submits → status: submitted
Supervisor reviews → status: approved → DAG triggers downstream
                   → status: rejected → back to in_progress (edits preserved, reviewer notes shown)
```

#### B. Canonical Storage: DB-First with S3 Export on Approval

**The problem**: Pipeline stages read inputs from S3. Human edits persist to DB. When downstream stages need human-edited data, where do they read from?

**Decision**: DB is canonical for editable annotations. Export to S3 on approval.

```
Human edits → annotation_sets.data (DB, JSONB)
                    │
                    └──→ On task approval: export to S3 in reference format
                          Key: results/{videoId}/{type}_approved.json
                          Format: full envelope (metadata + data array)
                          Pipeline reads this for downstream stages
```

This means the `tasks.review` mutation (approve path) must:
1. Read current `annotation_sets.data` for the approved type
2. Reconstruct metadata envelope (from `annotation_sets.metadata` + `processingJobs` record)
3. Write JSON to S3 at the result key expected by downstream stages
4. Then trigger downstream DAG stages

#### C. Transcription Editing Scope

**The problem**: "Editable speech transcripts with drag-to-resize word blocks" — does this mean boundary edits only, or also text correction?

**Decision**: Phase 4 scope = boundary edits + speaker reassignment. Text correction deferred.

| Operation | In Scope | Notes |
|-----------|----------|-------|
| Resize word boundaries | Yes | Drag left/right edges |
| Delete words | Yes | Remove spurious word |
| Split words | No | Rarely needed, complex |
| Merge adjacent words | Yes | If same speaker |
| Change speaker assignment | Yes | Via classify dialog |
| Correct word text | No | Deferred — requires inline text editing UI |

Immutable fields during transcription edits: `confidence`, `speech_segment`. These are AI-generated provenance and should not change when humans adjust boundaries.

#### D. Time Coverage Validation on Save + Submit

**The problem**: Reference requires annotations to cover the full video duration (±0.1s tolerance, no gaps >0.1s). The plan only validates local constraints (overlaps, bounds, min duration).

**Decision**: Add global coverage validation. Enforced at two points:

1. **`annotations.save` mutation**: Warn but allow save (coverage gaps are valid during editing — user may be mid-work)
2. **`tasks.submit` mutation**: Reject if coverage is invalid. Annotator must fix gaps before submitting.

```typescript
// time-validation.ts
function validateCoverage(
  data: { time_range: TimeRange }[],
  totalDuration: number,
  tolerance = 0.1
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (data.length === 0) return { valid: false, errors: ['No annotations'] };

  if (data[0].time_range.start > tolerance)
    errors.push(`Data starts late: ${data[0].time_range.start}s`);

  if (data[data.length - 1].time_range.end < totalDuration - tolerance)
    errors.push(`Data ends early: missing last ${totalDuration - data[data.length - 1].time_range.end}s`);

  for (let i = 0; i < data.length - 1; i++) {
    const gap = data[i + 1].time_range.start - data[i].time_range.end;
    if (gap > tolerance) errors.push(`Gap at ${data[i].time_range.end}s (${gap.toFixed(2)}s)`);
  }

  return { valid: errors.length === 0, errors };
}
```

**Note**: Coverage enforcement applies only to state annotations (which must partition the timeline). Intents and backchannels are sparse — they don't need full coverage.

### 10.2 Data Format Clarifications (MEDIUM)

#### E. Field Immutability Rules

During editing, only specific fields may change. All others are preserved as-is.

| Type | Mutable Fields | Immutable Fields (preserved on edit) |
|------|---------------|--------------------------------------|
| **StateAnnotation** | `time_range`, `category` | `note`, `parameters` |
| **IntentAnnotation** | `time_range`, `intent_classification.intent`, `.intensity`, `.valence` | `intent_classification.confidence`, `.reasoning` |
| **SpeechWord** | `time_range`, `speech.speaker` | `speech.word`, `speech.confidence`, `speech.speech_segment` |
| **BackchannelAnnotation** | `time_range`, `backchannel.type`, `backchannel.note` | `backchannel.speaker` |

Rationale: Confidence and reasoning are AI provenance. Humans correct categories and boundaries; the system tracks that the correction happened via `annotation_edits`.

#### F. Split/Merge Semantics Per Type

**Split** (at playhead time `t`, splitting annotation at index `i`):

```typescript
// Both halves inherit ALL fields from original. Only time_range changes.
function splitAnnotation<T extends { time_range: TimeRange }>(
  items: T[], index: number, splitTime: number
): T[] {
  const original = items[index];
  if (splitTime <= original.time_range.start || splitTime >= original.time_range.end) return items;
  const half1 = { ...structuredClone(original), time_range: { start: original.time_range.start, end: splitTime } };
  const half2 = { ...structuredClone(original), time_range: { start: splitTime, end: original.time_range.end } };
  return [...items.slice(0, index), half1, half2, ...items.slice(index + 1)];
}
```

**Merge** (two adjacent annotations):

```typescript
// Only allowed when:
// - States: same category
// - Intents: same intent type (intensity/valence may differ — take from first)
// - Transcription: same speaker
// - Adjacency: |a.end - b.start| < 0.05s (50ms tolerance)
function canMerge<T>(a: T, b: T, getCategory: (t: T) => string): boolean {
  return getCategory(a) === getCategory(b);
}
```

When merging intents with different intensity/valence: take the values from the **longer** segment (higher confidence proxy). Document in ClassifyDialog that user can reclassify after merge.

#### G. Gap Semantics

State annotations must be **contiguous** (no gaps allowed — the visible speaker is always either speaking or listening). This is enforced by:
- Coverage validation on submit (§D above)
- Delete operation on states: if deleting a state, the adjacent blocks auto-expand to fill the gap (or prompt user to choose which neighbor absorbs the time)

Intents and backchannels are **sparse** — gaps are allowed and expected. Not every moment has an intent.

#### H. Metadata Preservation on Save

When saving edited annotations to `annotation_sets`:

```typescript
// annotation_sets row structure:
{
  data: editedAnnotationArray,     // The human-edited JSONB array
  metadata: {
    original_algorithm: { /* preserved from AI pipeline output */ },
    edit_summary: {
      total_edits: number,
      edit_types: Record<EditType, number>,  // count per type
      last_edited_by: userId,
      last_edited_at: timestamp,
    }
  },
  source: 'human',  // Changed from 'ai' on first human edit
}
```

The `metadata` JSONB column (already in schema) stores both AI provenance and edit summary. This allows comparing human output against AI baseline for QC metrics.

### 10.3 Stage-to-Task Constraint Mapping (MEDIUM)

Explicit mapping of realistic constraint sets per task type:

| taskType | editableTypes | allowedOperations | allowedCategories | lockedTimeRanges | coverageRequired |
|----------|---------------|-------------------|-------------------|------------------|------------------|
| `tag_session_bounds` | `['session_bounds']` | `['create', 'resize', 'delete']` | `['session.exclude']` | none | no |
| `verify_states` | `['state']` | `['resize', 'classify', 'split', 'merge']` | `['expression.state.speaking', 'expression.state.listening']` | from session_bounds exclusions | yes (contiguous) |
| `verify_intents` | `['intent']` | `['resize', 'classify', 'split', 'merge', 'delete', 'create']` | all 6 intent types | from session_bounds exclusions | no (sparse) |
| `tag_backchannels` | `['backchannel']` | `['create', 'delete', 'classify']` | all backchannel types | from session_bounds exclusions | no (sparse) |

### 10.4 Task Lifecycle State Diagram (MEDIUM)

```
┌──────────┐
│ Pending  │  ← Created by supervisor/auto-generated after pipeline stage completes
└────┬─────┘
     │ supervisor assigns to annotator
     ▼
┌──────────┐
│ Assigned │  ← Annotator sees in task list
└────┬─────┘
     │ annotator opens viewer with ?taskId=xxx, clicks "Start"
     ▼
┌────────────┐
│In Progress │  ← Timer running, edits auto-saving, localStorage draft active
└────┬───────┘
     │ annotator clicks "Submit" (coverage validated for states)
     ▼
┌───────────┐
│ Submitted │  ← Annotator done, awaiting supervisor review
└────┬──────┘
     │ supervisor reviews
     ├──→ Approved → Export to S3 → Trigger downstream DAG stages
     │      └──→ Task terminal state
     │
     └──→ Rejected (with notes) → Back to In Progress
            └──→ Annotator sees rejection notes, can re-edit and re-submit
```

### 10.5 API-Level Constraint Enforcement (HIGH)

The `annotations.save` mutation must validate server-side:

```typescript
async function validateSavePermissions(
  userId: string,
  videoId: string,
  type: AnnotationSetType,
  task: Task | null,
  db: Database
) {
  // 1. User must be authenticated
  if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

  // 2. If task exists, validate constraints
  if (task) {
    const constraints = task.constraints as TaskConstraints;

    // Task must be in_progress
    if (task.status !== 'in_progress')
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Task is not in progress' });

    // User must be assigned
    if (task.assignedTo !== userId)
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not assigned to this task' });

    // Type must be in editableTypes
    if (!constraints.editableTypes.includes(type))
      throw new TRPCError({ code: 'FORBIDDEN', message: `Cannot edit ${type} in this task` });
  }

  // 3. Without a task, user must be admin or supervisor
  if (!task) {
    const user = await getUser(userId, db);
    if (user.role === 'annotator')
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Annotators must work through tasks' });
  }
}
```

### 10.6 Read-Only vs Editable Track Matrix

| Track | Rendering | Editable | Source | Edit Operations |
|-------|-----------|----------|--------|-----------------|
| Time Ruler | Canvas | — | Derived | — |
| VAD | Canvas | No | S3 JSON | — |
| Energy | Canvas | No | Derived from VAD | — |
| Diarization | Canvas | No | S3 JSON | — |
| Mouth Energy | Canvas | No | S3 JSON | — |
| Transcription | DOM | Yes (boundaries + speaker) | DB JSONB | resize, delete, merge |
| States | DOM | Yes | DB JSONB | resize, classify, split, merge |
| Intents | DOM | Yes | DB JSONB | all operations |
| Backchannels | DOM | Yes (Phase 7) | DB JSONB | create, delete, classify |

### 10.7 Lower Priority Items (Documented for Future Waves)

**Single-select only in Phase 4**: Multi-select (Shift+click, Ctrl+click) deferred to Phase 5. Document as a known limitation.

**Gaze/head pose tracks**: Not rendered in Phase 3 viewer (facial tracking excluded due to 15MB size). Remains deferred. Not blocking editing.

**Keyboard shortcut conflict resolution**: All single-key shortcuts (N, S, M, C, Delete) must check `event.target` — if target is an input/textarea, do not fire. The existing `handleKeydown` in AnnotationViewer.svelte already has this guard for `INPUT` tags; extend to `TEXTAREA` and elements with `contenteditable`.

**Drag edge cases**:
- Drag beyond video duration → clamp to `duration`
- Drag to zero width → clamp to minimum (50ms)
- Multiple concurrent drags → pointer capture prevents this
- Touch devices → pointer events work natively; pinch-to-zoom deferred

**Delete on contiguous states**: When deleting a state annotation (which must maintain contiguous coverage), show a dialog: "Expand left neighbor" / "Expand right neighbor" / "Cancel". The absorbing neighbor's time range extends to fill the gap.

**"bulk" edit type**: Used when reverting an entire annotation_set to a previous version, or when applying a template/batch operation across multiple annotations in one save. Not exposed as a user-facing operation in Phase 4.
