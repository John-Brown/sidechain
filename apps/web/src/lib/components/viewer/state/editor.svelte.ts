import { getContext, setContext } from 'svelte';
import type {
  StateAnnotation,
  IntentAnnotation,
  SpeechWord,
  BackchannelAnnotation,
} from '@annotation/shared';
import { History } from './history.svelte.js';
import type { AnnotationDataState } from './annotation-data.svelte.js';

const EDITOR_KEY = Symbol('editor');

export class EditorState {
  editing = $state(false);

  // Editable annotation arrays — null when not in edit mode
  states: StateAnnotation[] | null = $state(null);
  intents: IntentAnnotation[] | null = $state(null);
  transcription: SpeechWord[] | null = $state(null);
  backchannels: BackchannelAnnotation[] | null = $state(null);

  // Dirty tracking per annotation type
  #dirtyFlags = $state<Record<string, boolean>>({});

  // History instances per editable type
  stateHistory = new History<StateAnnotation[]>();
  intentHistory = new History<IntentAnnotation[]>();
  transcriptionHistory = new History<SpeechWord[]>();
  backchannelHistory = new History<BackchannelAnnotation[]>();

  get hasChanges(): boolean {
    return Object.values(this.#dirtyFlags).some(Boolean);
  }

  enterEditMode(annotationData: AnnotationDataState): void {
    this.states = annotationData.stateAnnotation?.data
      ? structuredClone(annotationData.stateAnnotation.data)
      : null;
    this.intents = annotationData.intentClassification?.data
      ? structuredClone(annotationData.intentClassification.data)
      : null;
    this.transcription = annotationData.transcription?.data
      ? structuredClone(annotationData.transcription.data)
      : null;
    // Backchannels aren't in AnnotationDataState (not a pipeline stage) — start empty
    this.backchannels = null;

    this.editing = true;
    this.stateHistory.clear();
    this.intentHistory.clear();
    this.transcriptionHistory.clear();
    this.backchannelHistory.clear();
    this.#dirtyFlags = {};
  }

  exitEditMode(): void {
    this.states = null;
    this.intents = null;
    this.transcription = null;
    this.backchannels = null;
    this.editing = false;
    this.stateHistory.clear();
    this.intentHistory.clear();
    this.transcriptionHistory.clear();
    this.backchannelHistory.clear();
    this.#dirtyFlags = {};
  }

  markDirty(type: string): void {
    this.#dirtyFlags = { ...this.#dirtyFlags, [type]: true };
  }

  isDirty(type: string): boolean {
    return this.#dirtyFlags[type] ?? false;
  }

  getDirtyTypes(): string[] {
    return Object.entries(this.#dirtyFlags)
      .filter(([, dirty]) => dirty)
      .map(([type]) => type);
  }
}

export function setEditorState(state: EditorState) {
  setContext(EDITOR_KEY, state);
}

export function getEditorState(): EditorState {
  return getContext<EditorState>(EDITOR_KEY);
}
