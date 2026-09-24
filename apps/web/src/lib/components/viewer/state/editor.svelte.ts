import type {
  StateAnnotation,
  IntentAnnotation,
  SpeechWord,
  BackchannelAnnotation,
  UserLabel,
  EditType,
} from '@annotation/shared';
import { History } from './history.svelte.js';
import type { AnnotationDataState } from './annotation-data.svelte.js';
import {
  isHumanReviewed,
  reviewKey,
  withReview,
  type ReviewableAnnotation,
} from '../review.js';

export type EditableType = 'states' | 'intents' | 'transcription' | 'backchannels' | 'userLabels';

/** Undo depth per type (History snapshots and the matching audit-edit steps) */
const MAX_UNDO = 50;

/**
 * Types Reclassify (C) acts on: the ClassifyDialog for states and intents, the
 * text dialog for user labels. Words and backchannels have nothing to reclassify.
 */
export const RECLASSIFIABLE_TYPES: readonly EditableType[] = ['states', 'intents', 'userLabels'];

export function isReclassifiable(type: EditableType): boolean {
  return RECLASSIFIABLE_TYPES.includes(type);
}

const EDITABLE_TYPES: readonly EditableType[] = ['states', 'intents', 'transcription', 'backchannels', 'userLabels'];

function emptySteps(): Record<EditableType, EditRecord[][]> {
  return Object.fromEntries(EDITABLE_TYPES.map((t) => [t, []])) as unknown as Record<EditableType, EditRecord[][]>;
}

export interface EditRecord {
  editType: EditType;
  targetIndex: number | null;
  beforeState: unknown;
  afterState: unknown;
}

export class EditorState {
  editing = $state(false);

  // Editable annotation arrays — null when not in edit mode
  states: StateAnnotation[] | null = $state(null);
  intents: IntentAnnotation[] | null = $state(null);
  transcription: SpeechWord[] | null = $state(null);
  backchannels: BackchannelAnnotation[] | null = $state(null);
  userLabels: UserLabel[] | null = $state(null);

  // Tracks which annotation type was last edited (for keyboard undo/redo)
  lastEditedType: EditableType | null = $state(null);

  // Selection state (shared between EditableDOMTrack and keyboard shortcuts)
  selectedType: EditableType | null = $state(null);
  selectedIndex: number | null = $state(null);

  // Dirty tracking per annotation type
  #dirtyFlags = $state<Record<string, boolean>>({});

  // Monotonic counter — increments on every markDirty call so $effect can re-trigger
  dirtyVersion = $state(0);

  /** profiles.id of the signed-in user, for `review.by` stamps (the server re-stamps on save) */
  reviewerId: string | null = $state(null);

  // History instances per editable type
  stateHistory = new History<StateAnnotation[]>(MAX_UNDO);
  intentHistory = new History<IntentAnnotation[]>(MAX_UNDO);
  transcriptionHistory = new History<SpeechWord[]>(MAX_UNDO);
  backchannelHistory = new History<BackchannelAnnotation[]>(MAX_UNDO);
  userLabelHistory = new History<UserLabel[]>(MAX_UNDO);

  // Pending edit records per type — accumulated between saves
  #pendingEdits: Record<string, EditRecord[]> = {};

  // Per-type markDirty counters (typeVersion / clearDirtyIfUnchanged)
  #typeVersions: Record<string, number> = {};

  /**
   * Audit edits per undo step, parallel to each History stack: pushUndo opens
   * a step, recordEdit adds to the newest one. undo() takes the step's edits
   * out of the pending batch (an undone edit that was never saved is never
   * sent) and redo() puts them back, so the audit trail follows the undo
   * stack. Edits already saved stay in annotation_edits; undoing them saves a
   * new version without the change.
   */
  #undoSteps = emptySteps();
  #redoSteps = emptySteps();

  /**
   * Stable keys (`start|end|label`, see review.ts) of items a human has
   * decided on (confirmed, reclassified, created), for a type. Derived from
   * the per-item `review` stamp, so undo/redo, drafts and saves keep it in
   * sync with no extra state. O(n) per call: wrap it in `$derived` in
   * components. Empty outside edit mode.
   */
  reviewedKeys(type: EditableType): ReadonlySet<string> {
    return reviewedKeySet(this[type] as ReviewableAnnotation[] | null);
  }

  /** Whether the item at `index` has been decided on by a human. */
  isReviewed(type: EditableType, index: number): boolean {
    const item = (this[type] as ReviewableAnnotation[] | null)?.[index];
    return item ? isHumanReviewed(item) : false;
  }

  /** Snapshot the current array of `type` onto its undo stack. Call before every commit. */
  pushUndo(type: EditableType): void {
    if (this[type] === null) return;
    const steps = this.#undoSteps[type];
    steps.push([]);
    if (steps.length > MAX_UNDO) steps.shift();
    this.#redoSteps[type] = [];
    switch (type) {
      case 'states':
        if (this.states) this.stateHistory.push(structuredClone($state.snapshot(this.states)));
        break;
      case 'intents':
        if (this.intents) this.intentHistory.push(structuredClone($state.snapshot(this.intents)));
        break;
      case 'transcription':
        if (this.transcription) this.transcriptionHistory.push(structuredClone($state.snapshot(this.transcription)));
        break;
      case 'backchannels':
        if (this.backchannels) this.backchannelHistory.push(structuredClone($state.snapshot(this.backchannels)));
        break;
      case 'userLabels':
        if (this.userLabels) this.userLabelHistory.push(structuredClone($state.snapshot(this.userLabels)));
        break;
    }
  }

  /**
   * Accept an AI prediction without changing it (↵ / "Confirm prediction").
   * Stamps `review: { source: 'human', confirmed: true }` on the item, pushes
   * undo, records a "confirm" audit edit and marks the type dirty so autosave
   * persists it. Returns false (and does nothing) outside edit mode, for a bad
   * index, or when a human already decided on the item.
   */
  confirm(type: EditableType, index: number, opts: { by?: string } = {}): boolean {
    if (!this.editing) return false;
    const arr = this[type] as ReviewableAnnotation[] | null;
    if (!arr || index < 0 || index >= arr.length) return false;
    if (isHumanReviewed(arr[index])) return false;

    this.pushUndo(type);
    const next = structuredClone($state.snapshot(arr)) as ReviewableAnnotation[];
    const before = next[index];
    const after = withReview(before, { confirmed: true, by: opts.by ?? this.reviewerId ?? undefined });
    next[index] = after;
    (this as unknown as Record<EditableType, ReviewableAnnotation[]>)[type] = next;

    this.recordEdit(type, {
      editType: 'confirm',
      targetIndex: index,
      beforeState: before,
      afterState: after,
    });
    this.lastEditedType = type;
    this.markDirty(type);
    return true;
  }

  /** confirm() on the current selection. */
  confirmSelected(opts: { by?: string } = {}): boolean {
    if (this.selectedType === null || this.selectedIndex === null) return false;
    return this.confirm(this.selectedType, this.selectedIndex, opts);
  }

  /** Record an edit for the audit trail (batched until next save), on the newest undo step */
  recordEdit(type: EditableType, edit: EditRecord): void {
    if (!this.#pendingEdits[type]) {
      this.#pendingEdits[type] = [];
    }
    this.#pendingEdits[type].push(edit);
    const steps = this.#undoSteps[type];
    if (steps.length > 0) steps[steps.length - 1].push(edit);
  }

  /** Edits waiting for the next save of `type` (read-only view, for tests and the save indicator) */
  pendingEdits(type: EditableType): readonly EditRecord[] {
    return this.#pendingEdits[type] ?? [];
  }

  /** Get and clear pending edits for a type (called by autosave on save) */
  getAndClearEdits(type: EditableType): EditRecord[] {
    const edits = this.#pendingEdits[type] ?? [];
    delete this.#pendingEdits[type];
    return edits;
  }

  get hasChanges(): boolean {
    return Object.values(this.#dirtyFlags).some(Boolean);
  }

  get canUndo(): boolean {
    if (!this.lastEditedType) return false;
    return this.#canUndoType(this.lastEditedType);
  }

  get canRedo(): boolean {
    if (!this.lastEditedType) return false;
    return this.#canRedoType(this.lastEditedType);
  }

  /**
   * Undo the last operation on the most recently edited type. Marks the type
   * dirty so autosave persists the restored array (an undone confirm must
   * reach the server too), and withdraws the step's unsaved audit edits.
   */
  undo(): boolean {
    const type = this.lastEditedType;
    if (!type) return false;
    const ok = this.#undoType(type);
    if (!ok) return false;
    const step = this.#undoSteps[type].pop() ?? [];
    const pending = this.#pendingEdits[type];
    if (pending && step.length > 0) {
      this.#pendingEdits[type] = pending.filter((e) => !step.includes(e));
    }
    this.#redoSteps[type].push(step);
    this.#dropStaleSelection(type);
    this.markDirty(type);
    return true;
  }

  /** Redo the last undone operation on the most recently edited type; re-queues its audit edits and marks dirty. */
  redo(): boolean {
    const type = this.lastEditedType;
    if (!type) return false;
    const ok = this.#redoType(type);
    if (!ok) return false;
    const step = this.#redoSteps[type].pop() ?? [];
    const pending = (this.#pendingEdits[type] ??= []);
    for (const edit of step) if (!pending.includes(edit)) pending.push(edit);
    this.#undoSteps[type].push(step);
    this.#dropStaleSelection(type);
    this.markDirty(type);
    return true;
  }

  /**
   * After undo/redo replaced `type`'s array, a selection on it may point at a
   * different item (create/split/merge shift indices), so ⌫, S, M or ↵ would
   * act on the wrong one. Clear it.
   */
  #dropStaleSelection(type: EditableType): void {
    if (this.selectedType === type) this.deselect();
  }

  #canUndoType(type: EditableType): boolean {
    switch (type) {
      case 'states': return this.stateHistory.canUndo;
      case 'intents': return this.intentHistory.canUndo;
      case 'transcription': return this.transcriptionHistory.canUndo;
      case 'backchannels': return this.backchannelHistory.canUndo;
      case 'userLabels': return this.userLabelHistory.canUndo;
    }
  }

  #canRedoType(type: EditableType): boolean {
    switch (type) {
      case 'states': return this.stateHistory.canRedo;
      case 'intents': return this.intentHistory.canRedo;
      case 'transcription': return this.transcriptionHistory.canRedo;
      case 'backchannels': return this.backchannelHistory.canRedo;
      case 'userLabels': return this.userLabelHistory.canRedo;
    }
  }

  #undoType(type: EditableType): boolean {
    switch (type) {
      case 'states': {
        if (!this.states) return false;
        const snap = this.stateHistory.undo(this.states);
        if (!snap) return false;
        this.states = snap;
        return true;
      }
      case 'intents': {
        if (!this.intents) return false;
        const snap = this.intentHistory.undo(this.intents);
        if (!snap) return false;
        this.intents = snap;
        return true;
      }
      case 'transcription': {
        if (!this.transcription) return false;
        const snap = this.transcriptionHistory.undo(this.transcription);
        if (!snap) return false;
        this.transcription = snap;
        return true;
      }
      case 'backchannels': {
        if (!this.backchannels) return false;
        const snap = this.backchannelHistory.undo(this.backchannels);
        if (!snap) return false;
        this.backchannels = snap;
        return true;
      }
      case 'userLabels': {
        if (!this.userLabels) return false;
        const snap = this.userLabelHistory.undo(this.userLabels);
        if (!snap) return false;
        this.userLabels = snap;
        return true;
      }
    }
  }

  #redoType(type: EditableType): boolean {
    switch (type) {
      case 'states': {
        if (!this.states) return false;
        const snap = this.stateHistory.redo(this.states);
        if (!snap) return false;
        this.states = snap;
        return true;
      }
      case 'intents': {
        if (!this.intents) return false;
        const snap = this.intentHistory.redo(this.intents);
        if (!snap) return false;
        this.intents = snap;
        return true;
      }
      case 'transcription': {
        if (!this.transcription) return false;
        const snap = this.transcriptionHistory.redo(this.transcription);
        if (!snap) return false;
        this.transcription = snap;
        return true;
      }
      case 'backchannels': {
        if (!this.backchannels) return false;
        const snap = this.backchannelHistory.redo(this.backchannels);
        if (!snap) return false;
        this.backchannels = snap;
        return true;
      }
      case 'userLabels': {
        if (!this.userLabels) return false;
        const snap = this.userLabelHistory.redo(this.userLabels);
        if (!snap) return false;
        this.userLabels = snap;
        return true;
      }
    }
  }

  enterEditMode(annotationData: AnnotationDataState): void {
    // Use $state.snapshot() to unwrap Svelte 5 proxies before cloning
    this.states = annotationData.stateAnnotation?.data
      ? structuredClone($state.snapshot(annotationData.stateAnnotation.data))
      : null;
    this.intents = annotationData.intentClassification?.data
      ? structuredClone($state.snapshot(annotationData.intentClassification.data))
      : null;
    this.transcription = annotationData.transcription?.data
      ? structuredClone($state.snapshot(annotationData.transcription.data))
      : null;
    // Backchannels: human-only type (loaded from DB), initialize from annotationData if present
    this.backchannels = annotationData.backchannel?.data
      ? structuredClone($state.snapshot(annotationData.backchannel.data))
      : null;
    // User labels: human-only type, initialize from annotationDataState if present, else empty array
    this.userLabels = annotationData.userLabels?.data
      ? structuredClone($state.snapshot(annotationData.userLabels.data))
      : [];

    this.editing = true;
    this.lastEditedType = null;
    this.selectedType = null;
    this.selectedIndex = null;
    this.stateHistory.clear();
    this.intentHistory.clear();
    this.transcriptionHistory.clear();
    this.backchannelHistory.clear();
    this.userLabelHistory.clear();
    this.#dirtyFlags = {};
    this.#pendingEdits = {};
    this.#undoSteps = emptySteps();
    this.#redoSteps = emptySteps();
  }

  exitEditMode(): void {
    this.states = null;
    this.intents = null;
    this.transcription = null;
    this.backchannels = null;
    this.userLabels = null;
    this.editing = false;
    this.lastEditedType = null;
    this.selectedType = null;
    this.selectedIndex = null;
    this.stateHistory.clear();
    this.intentHistory.clear();
    this.transcriptionHistory.clear();
    this.backchannelHistory.clear();
    this.userLabelHistory.clear();
    this.#dirtyFlags = {};
    this.#pendingEdits = {};
    this.#undoSteps = emptySteps();
    this.#redoSteps = emptySteps();
  }

  markDirty(type: string): void {
    this.#dirtyFlags = { ...this.#dirtyFlags, [type]: true };
    this.#typeVersions[type] = (this.#typeVersions[type] ?? 0) + 1;
    this.dirtyVersion++;
  }

  /**
   * Per-type change counter (bumped by every markDirty of `type`). Autosave
   * reads it before a save and clears the flag only if it hasn't moved, so an
   * edit or undo made while the save is in flight stays dirty.
   */
  typeVersion(type: string): number {
    return this.#typeVersions[type] ?? 0;
  }

  /** Clear `type`'s dirty flag if nothing marked it since `version` (typeVersion) was read. Returns whether it cleared. */
  clearDirtyIfUnchanged(type: string, version: number): boolean {
    if (this.typeVersion(type) !== version || !this.#dirtyFlags[type]) return false;
    const { [type]: _cleared, ...rest } = this.#dirtyFlags;
    this.#dirtyFlags = rest;
    return true;
  }

  /**
   * Put edits taken by getAndClearEdits back at the front of the pending
   * batch (a failed save), skipping any an undo has withdrawn meanwhile.
   */
  requeueEdits(type: EditableType, edits: readonly EditRecord[]): void {
    if (edits.length === 0) return;
    // Withdrawn = sitting on the redo stack (undone before this retry)
    const back = edits.filter((e) => !this.#redoSteps[type].some((step) => step.includes(e)));
    this.#pendingEdits[type] = [...back, ...(this.#pendingEdits[type] ?? []).filter((e) => !back.includes(e))];
  }

  isDirty(type: string): boolean {
    return this.#dirtyFlags[type] ?? false;
  }

  getDirtyTypes(): string[] {
    return Object.entries(this.#dirtyFlags)
      .filter(([, dirty]) => dirty)
      .map(([type]) => type);
  }

  /** Clear all dirty flags (called after successful save) */
  clearDirty(): void {
    this.#dirtyFlags = {};
    // Don't reset dirtyVersion — it's monotonic so future markDirty calls still trigger effects
  }

  select(type: EditableType, index: number): void {
    this.selectedType = type;
    this.selectedIndex = index;
  }

  deselect(): void {
    this.selectedType = null;
    this.selectedIndex = null;
  }

  get hasSelection(): boolean {
    return this.selectedType !== null && this.selectedIndex !== null;
  }

  /** Get the data array for the selected type */
  get selectedArray(): { time_range: { start: number; end: number } }[] | null {
    if (!this.selectedType) return null;
    return this[this.selectedType] as { time_range: { start: number; end: number } }[] | null;
  }
}

function reviewedKeySet(items: readonly ReviewableAnnotation[] | null): ReadonlySet<string> {
  const keys = new Set<string>();
  if (!items) return keys;
  for (const item of items) {
    if (isHumanReviewed(item)) keys.add(reviewKey(item));
  }
  return keys;
}
