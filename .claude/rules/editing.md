---
paths:
  - "apps/web/src/lib/components/viewer/**"
---

# Phase 4: Editing + Task Mode Conventions

Reference plan (archived, phase complete): `plans/archive/phase-4-editing-task-mode.md`. UI reworked in the 2026-09-24 design pass (review queue, confirm, toolbars, mounted dialogs and menus).

## Editor State Architecture

`editorState` (mutable) is a separate layer over `annotationDataState` (immutable/read-only):
- On entering edit mode: `structuredClone` editable arrays from annotationDataState into editorState
- DOM tracks read from editorState in edit mode, annotationDataState in view mode
- Canvas tracks always read annotationDataState (never editable)
- Dirty tracking per annotation type; diff against original to detect changes
- Leaving edit mode (⌘E, Esc with nothing selected) saves pending changes, then writes the editor arrays back into annotationDataState so view mode shows the session's edits

## Editable vs Read-Only

| Editable (DOM, editorState) | Read-Only (Canvas, annotationDataState) |
|-----------------------------|----------------------------------------|
| states, intents, transcription, backchannels, userLabels | waveform, VAD, diarization, mouth energy, head pose (facial tracking) |

## Review and Confirm

- `LOW_CONFIDENCE = 0.6` is the one shared constant (`viewer/review.ts`). An item is **reviewed** once it carries a human `review` stamp (`AnnotationReview` in `@annotation/shared`, persisted in the set's JSONB `data`).
- **Confirm** (↵, the Inspector's Confirm button, EditToolbar, context menu): `editor.confirm(type, index, { by })` / `confirmSelected()` stamps `review: { source: 'human', confirmed: true, by }` without changing the item, pushes undo, records an `editType: 'confirm'` audit edit and marks the type dirty. It is a no-op on items a human already decided on and on user labels. After confirming, the viewer selects the next queue item (no wrap).
- **Reclassify** (C) stamps `review: { confirmed: false }` along with the new category. It applies to states, intents and user labels only (`RECLASSIFIABLE_TYPES` / `isReclassifiable` in `editor.svelte.ts`; the toolbar, context menu and `openReclassify` share it). **Create** stamps human provenance.
- **Split, merge, resize and move** re-stamp the items they produce `review: { confirmed: false }` (`stampExtentEdit(item, by, from)`): a human changed the extent, so an old "accepted unchanged" stamp no longer holds, and a merge doesn't inherit only one side's stamp. User labels carry no stamp.
- **Review origin**: every stamp carries `review.origin`, the key of the item's original AI form, taken from the pre-edit item (`withReview(..., { from })`). Reclassify, resize, move, confirm and both split halves keep it; a merge keeps the lower item's; a created item has none (`from: null`). The queue matches reviewed rows by it (`data-contracts.md`).
- `annotations.save` rejects a `confirm` edit without a target index or a `review.confirmed === true` after-state, and, when the save carries `taskId`, any edit whose type isn't in the task's `allowedOperations`. It also server-stamps review provenance (see `data-contracts.md`). The pure checks live in `server/trpc/annotation-save-rules.ts` (unit-tested).
- **Review queue** (`buildReviewQueue`, see `viewer.md`): ⇥ / ⇧⇥ step through it, **only while the viewer root has focus**. A pointer click on a queue row puts focus there, focus stays on the root after each step, and ↵ confirms the selected item. In task mode the queue only holds items the task may act on: its `reviewScope`, minus items overlapping a locked range. The progress counters and checklist leave locked items out too.

## Undo/Redo

Snapshot-based via `structuredClone`. Push on `pointerup` (drag commit), create, delete, split, merge, classify, confirm, NOT during drag. Max 50 snapshots (~5MB). Generic `History<T>` class in `state/history.svelte.ts`, instantiated per editable type in EditorState (`stateHistory`, `intentHistory`, `transcriptionHistory`, `backchannelHistory`, `userLabelHistory`). ⌘Z / ⇧⌘Z act on `lastEditedType`; a successful undo or redo clears a selection on that type, because create/split/merge shift indices.

A successful undo or redo also **marks the type dirty**, so autosave (and task submit's `saveNow`) persists the restored array. An undone confirm must reach the server too. **Pending audit edits follow the undo stack**: `pushUndo` opens a step, `recordEdit` adds to it, `undo()` withdraws that step's edits from the pending batch, and `redo()` re-queues them. So an edit undone before a save is never sent to `annotation_edits`. An edit that was already saved stays in the audit log, and its undo is saved as a new version with no compensating edit row (the version diff shows it).

**Undo during an in-flight save**: autosave reads `editor.typeVersion(type)` before each type's request and clears that type's dirty flag afterwards only if the version hasn't moved (`clearDirtyIfUnchanged`). An undo (or any edit) made while the request is out keeps the type dirty, and the next save sends the array without the undone stamp. **Audit caveat**: the edits taken for the in-flight request (`getAndClearEdits`) can't be un-sent, so a confirm undone mid-save still lands in `annotation_edits`, like any undo of a saved edit. A failed request re-queues its edits (minus any undone since). A `saveNow` while a save is running waits for it, then saves what is still dirty.

**Restoring a supervisor stamp**: an annotator's undo can bring back a `supervisor_override` item they had re-stamped human with a resize. The server accepts it only if that exact item is stored in an earlier version (see `data-contracts.md`).

## Drag-to-Resize + Drag-to-Move (60fps)

**Resize** (left/right handles: 4px teal bars, rendered only on the selected block):
1. `pointerdown` on handle → `stopPropagation` + `setPointerCapture`, record original time_range
2. `pointermove` → `requestAnimationFrame` → update ONLY inline `style.transform`/`style.width`: no store mutation, no reactivity
3. `pointerup` → compute final time, validate, commit to editorState, push undo snapshot

**Move** (block body):
1. `pointerdown` on block → `setPointerCapture`, record original time_range, `dragStarted = false`
2. `pointermove` → check 3px threshold before committing to drag (distinguishes click from move)
3. After threshold: `requestAnimationFrame` → shift `style.transform` (width stays constant)
4. `pointerup` → if threshold not met, treat as click (not drag). Otherwise compute final range, validate, commit.

During any drag: zero Svelte reactivity. One DOM mutation per frame on the `will-change: transform` element, plus the one pre-rendered `.blk-ghost` at the origin (positioned imperatively).
Cursor: `grab` on blocks, `grabbing` while dragging, `col-resize` on handles.

## Validation Rules

- `end - start >= 0.05` (50ms minimum)
- No overlap with adjacent same-type annotations
- `start >= 0`, `end <= duration`
- Task mode: cannot extend into locked time ranges; blocks inside one render `data-locked` and refuse every edit
- States must be contiguous (no gaps): **enforced on submit** (TaskSubmitDialog lists each gap with "Jump to gap" and disables Submit and ⌘↵ until it is fixed), warned on save
- Delete on states: adjacent block must absorb the gap

## Operations (Pure Functions)

All in `editing/operations.ts`. Signature: `(items: T[], index: number, ...args) → T[]`.

**Current state**: UI handlers call these operations directly: `AnnotationViewer.svelte` for delete/split/merge/classify, `EditToolbar.svelte` for create, `EditorState.confirm` for confirm. The command-executor layer described in `ai-first.md` is **not built yet**; only the `AnnotationCommand` types exist, in `packages/shared/src/command-types.ts`. New editing features should move toward that layer rather than adding more direct handler→operation calls.

## EditToolbar (`components/EditToolbar.svelte`)

Shown in view and edit mode (TaskToolbar replaces it in task mode). Edit mode: "Add at playhead" buttons for State (N), Intent (I), Backchannel (B), Label (L), each creating a 1s item at the playhead when the range is free; the selection summary; Confirm, Reclassify, Split, Merge, Delete; Undo / Redo. `create(kind)` is exported for the N / I / B / L shortcuts. Handlers come from AnnotationViewer, so toolbar, keyboard and context menu run the same code.

## Dialogs and Menus (mounted by AnnotationViewer, bits-ui)

Each is mounted only while open; while any is open (`overlayOpen`) the global shortcut handler stands down, and each dialog stops key propagation itself.

| Overlay | Opens with | Notes |
|---------|-----------|-------|
| `ClassifyDialog` | C on a state or intent, Reclassify button, context menu | Category rows (1–6, ↑/↓, ↵ applies), intensity + valence for intents, "AI said inquire, 0.48" meta. In task mode `allowedCategories` disables the rows the task doesn't allow ("not in task") and Apply |
| `LabelTextDialog` | C or double-click on a user label | Rename the label text |
| `ContextMenu` | Right-click a block, the menu key or ⇧F10 | `blockMenuItems()`: Confirm ↵, Reclassify C, Split S, Merge M, Jump to start [, Delete ⌫. Disabled when not applicable, not allowed by the task, or locked |
| `TaskSubmitDialog` | ⌘↵ or the header's Submit | Reviewed count, edits, time on task (MM:SS), coverage gaps; Submit disabled while gaps exist |
| `KeyboardShortcutsHelp` | ? | The design's SHORTCUTS table (Playback, Review, Edit, View) |

## Keyboard Shortcuts (`handleKeydown` in AnnotationViewer)

Ignored in inputs, textareas, selects and contenteditable, and while an overlay is open. A focused control keeps its own keys: Space presses buttons, radios and options (it only plays from the body, the viewer root or a block), and ←/→/Home/End move sliders.

| Group | Keys |
|-------|------|
| Playback | Space play/pause · ←/→ ±1s · ⇧←/→ ±5s · Home / End · P picture-in-picture |
| Review | ⇥ / ⇧⇥ next / previous in review, **from the viewer root only** (focused by a pointer pick of a queue row; focus stays there after each step). On a block Tab and ⇧Tab are native: blocks use a roving tabindex per track, so ⇥ moves to the next or previous track's tabbable block or control and ←/→ move between blocks. No wrap: at either end of the queue, and from the body (page load), the header, panels or labels, Tab stays native, so focus is never trapped · ↵ confirm (body, root or a focused block) · C reclassify · 1–6 pick a category in the dialog |
| Edit | ⌘E toggle edit · N / I / B / L add state / intent / backchannel / label (edit mode) · S split at playhead · M merge next · ⌫ delete · [ jump to the selection's start · ⌘Z undo · ⇧⌘Z redo · ⌘S save now · Esc deselect, then leave edit mode |
| Task | ⌘↵ submit |
| View | N normalize (view mode) · F face mesh · V hide video · ⌥↑/⌥↓ move the focused (or selected) track · ? shortcuts |

## Auto-Save

- `$effect` watches `editor.dirtyVersion` → immediate localStorage draft → 30s debounce → tRPC `annotations.save` (⌘S saves now)
- localStorage key: `draft:{videoId}`. The `/dev/viewer` fixture keeps autosave in memory and writes no drafts
- On load: check for a draft newer than the DB version, offer restore (`DraftRecoveryBanner`)
- `AutoSaveState.status`: `idle` → `saving` → `saved` → `idle`; on error `error` with retry. `SaveIndicator` shows Saved (relative time) / Saving… / Unsaved · n edits / Save failed · reason

## User Labels

Human-only annotation type: no pipeline stage, no AI provenance. `UserLabel { time_range, text }`.

- **Create**: EditToolbar "Label" or L → 1s at the playhead, text "Label"
- **Rename**: double-click or C → LabelTextDialog
- **View mode**: read-only DOMTrack from `annotationData.userLabels` when data exists
- **Edit mode**: EditableDOMTrack with drag-resize, drag-move and undo/redo
- **Exit edit**: writes back to `annotationData.userLabels` so labels persist in view mode
- **AutoSave**: maps `userLabels` → `'user_labels'`
- **CSS**: `blk hue-label`

## Field Mutability

| Type | Mutable | Immutable (AI provenance) |
|------|---------|--------------------------|
| StateAnnotation | time_range, category, review | note, parameters |
| IntentAnnotation | time_range, intent, intensity, valence, review | confidence, reasoning |
| SpeechWord | time_range, speaker, review | word, confidence, speech_segment |
| UserLabel | time_range, text | (fully human-created) |

## Task Mode

Activated via `?taskId=xxx`. TaskConstraints JSONB defines `editableTypes`, `allowedCategories`, `lockedTimeRanges`, `allowedOperations`. Enforced in the UI (TaskToolbar lists them; handles, buttons, menu items and dialog rows are disabled; non-editable tracks collapse or read "read-only" with a lock) and on the server.

**Editable vs read-only** (`taskAccessFor` in `task-mode.svelte.ts`): a task is editable only for its assignee (`tasks.get` returns `assignedTo` and `assigneeName`) while it is `assigned` (the viewer starts it → `in_progress`) or `in_progress` (a rejected task returns there). Anyone else, or any other status, opens it **read-only**: task mode with its panel and toolbar, but no edit mode (⌘E does nothing), no autosave and no timer; TaskPanel shows "Read-only: assigned to X" or "Task is <status>", and the header's Submit reads Read-only. A submitted task becomes read-only too (the viewer leaves edit mode). `/dev/viewer?mode=task&as=other` shows the read-only case.

The viewer's autosave sends `taskId` only while `taskMode.editable`, and `annotations.save` then checks membership, that the task is for this video, is in progress and is assigned to the caller, `editableTypes`, and `allowedOperations` before writing. Without `taskId`, annotators are refused. `allowedCategories` and `lockedTimeRanges` are UI-only today. **Review scope** (`reviewScopeFor`): intents and/or words, whichever the task may edit. A task that edits neither (verify states, backchannels, session bounds) reviews nothing: the queue is empty, the two review checklist rows, the header progress and the submit dialog's reviewed row read N/A. Only a task with no constraints falls back to both. TaskPanel shows the brief (or a sentence built from the constraints), the "Before you submit" checklist, reviewer feedback and the open low-confidence items.

## Task Lifecycle

`pending` → `assigned` → `in_progress` → `submitted` → `approved`/`rejected`
- Pipeline triggers on **approved** (not submitted): supervisor gate
- On approval: export annotation_sets.data to S3 at `results/{videoId}/{type}_approved.json`, then trigger downstream DAG stages
