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

export type EditableType = 'states' | 'intents' | 'transcription' | 'backchannels' | 'userLabels';

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

  // History instances per editable type
  stateHistory = new History<StateAnnotation[]>();
  intentHistory = new History<IntentAnnotation[]>();
  transcriptionHistory = new History<SpeechWord[]>();
  backchannelHistory = new History<BackchannelAnnotation[]>();
  userLabelHistory = new History<UserLabel[]>();

  // Pending edit records per type — accumulated between saves
  #pendingEdits: Record<string, EditRecord[]> = {};

  /** Record an edit for the audit trail (batched until next save) */
  recordEdit(type: EditableType, edit: EditRecord): void {
    if (!this.#pendingEdits[type]) {
      this.#pendingEdits[type] = [];
    }
    this.#pendingEdits[type].push(edit);
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

  /** Undo the last operation on the most recently edited type */
  undo(): boolean {
    if (!this.lastEditedType) return false;
    return this.#undoType(this.lastEditedType);
  }

  /** Redo the last undone operation on the most recently edited type */
  redo(): boolean {
    if (!this.lastEditedType) return false;
    return this.#redoType(this.lastEditedType);
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
  }

  markDirty(type: string): void {
    this.#dirtyFlags = { ...this.#dirtyFlags, [type]: true };
    this.dirtyVersion++;
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
