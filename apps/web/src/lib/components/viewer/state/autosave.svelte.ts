/**
 * Auto-save module for annotation editing.
 *
 * Watches EditorState dirty flags, backs up to localStorage immediately,
 * debounces 30s for tRPC save, and tracks save status.
 *
 * Usage: instantiate in AnnotationViewer and pass to SaveIndicator/DraftRecoveryBanner.
 */

import type { EditorState, EditableType, EditRecord } from './editor.svelte.js';
import type { AnnotationSetType } from '@annotation/shared';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Maps editor field names to annotation_set types */
export const EDITABLE_TO_ANNOTATION_TYPE: Record<EditableType, AnnotationSetType> = {
  states: 'state',
  intents: 'intent',
  transcription: 'transcription',
  backchannels: 'backchannel',
  userLabels: 'user_labels',
};

export interface DraftData {
  states: unknown[] | null;
  intents: unknown[] | null;
  transcription: unknown[] | null;
  backchannels: unknown[] | null;
  userLabels: unknown[] | null;
  savedAt: number;
}

interface SaveFn {
  (videoId: string, type: AnnotationSetType, data: unknown, edits: EditRecord[]): Promise<void>;
}

export interface AutoSaveOptions {
  /**
   * Back up edits to localStorage as a recoverable draft (default true).
   * False keeps everything in memory, e.g. the /dev/viewer fixture, whose
   * save function is a no-op too.
   */
  persistDrafts?: boolean;
}

export class AutoSaveState {
  status: SaveStatus = $state('idle');
  lastSavedAt: number | null = $state(null);
  lastError: string | null = $state(null);

  #editor: EditorState;
  #videoId: string;
  #saveFn: SaveFn;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #savedStatusTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;
  /** The running save, if any (saveNow calls queue behind it) */
  #inflight: Promise<void> | null = null;
  #persistDrafts: boolean;

  constructor(editor: EditorState, videoId: string, saveFn: SaveFn, opts: AutoSaveOptions = {}) {
    this.#editor = editor;
    this.#videoId = videoId;
    this.#saveFn = saveFn;
    this.#persistDrafts = opts.persistDrafts ?? true;
  }

  /** Get the localStorage key for this video's draft */
  get draftKey(): string {
    return `draft:${this.#videoId}`;
  }

  /** Immediately back up current editor state to localStorage */
  saveDraft(): void {
    if (!this.#persistDrafts || !this.#editor.editing) return;

    const draft: DraftData = {
      states: this.#editor.states ? [...this.#editor.states] : null,
      intents: this.#editor.intents ? [...this.#editor.intents] : null,
      transcription: this.#editor.transcription ? [...this.#editor.transcription] : null,
      backchannels: this.#editor.backchannels ? [...this.#editor.backchannels] : null,
      userLabels: this.#editor.userLabels ? [...this.#editor.userLabels] : null,
      savedAt: Date.now(),
    };

    try {
      localStorage.setItem(this.draftKey, JSON.stringify(draft));
    } catch {
      // localStorage quota exceeded or unavailable — non-fatal
    }
  }

  /** Schedule a debounced save to the server (30s) */
  scheduleSave(): void {
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
    }

    this.#debounceTimer = setTimeout(() => {
      this.saveNow();
    }, 30_000);
  }

  /**
   * Force an immediate save of all dirty types.
   *
   * Each type's `typeVersion` is read before its save, and its dirty flag is
   * cleared afterwards only if the version hasn't moved. An edit or undo made
   * while the request is in flight therefore stays dirty, and the next save
   * sends the current array (e.g. without an undone confirm stamp). Caveat:
   * the audit edits already taken for the in-flight request can't be
   * un-sent, so a confirm undone mid-save still lands in annotation_edits
   * (like any undo of a saved edit, the next version shows the reversal).
   *
   * A call while a save is running waits for it, then saves whatever is
   * still dirty, so ⌘S and task submit never skip a change.
   */
  async saveNow(): Promise<void> {
    if (this.#inflight) {
      await this.#inflight.catch(() => {});
      return this.saveNow();
    }
    const run = this.#save();
    this.#inflight = run;
    try {
      await run;
    } finally {
      if (this.#inflight === run) this.#inflight = null;
    }
  }

  async #save(): Promise<void> {
    if (this.#disposed) return;
    if (!this.#editor.editing || !this.#editor.hasChanges) return;

    // Clear debounce timer
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    const dirtyTypes = this.#editor.getDirtyTypes() as EditableType[];
    if (dirtyTypes.length === 0) return;

    this.status = 'saving';
    this.lastError = null;

    try {
      for (const editorType of dirtyTypes) {
        const annotationType = EDITABLE_TO_ANNOTATION_TYPE[editorType];
        if (!annotationType) continue;

        const current = this.#editor[editorType];
        if (current === null) continue;

        // Snapshot before the await: what this request carries
        const version = this.#editor.typeVersion(editorType);
        const data = $state.snapshot(current);
        const edits = this.#editor.getAndClearEdits(editorType);
        try {
          await this.#saveFn(this.#videoId, annotationType, data, edits);
        } catch (err) {
          // Not sent: keep the audit edits for the retry
          this.#editor.requeueEdits(editorType, edits);
          throw err;
        }

        // Saved; stays dirty if it changed meanwhile
        this.#editor.clearDirtyIfUnchanged(editorType, version);
      }

      // Remove the localStorage draft once nothing is left unsaved
      if (this.#persistDrafts && !this.#editor.hasChanges) {
        try {
          localStorage.removeItem(this.draftKey);
        } catch {
          // non-fatal
        }
      }

      this.status = 'saved';
      this.lastSavedAt = Date.now();

      // Reset to idle after 2s
      if (this.#savedStatusTimer) {
        clearTimeout(this.#savedStatusTimer);
      }
      this.#savedStatusTimer = setTimeout(() => {
        if (this.status === 'saved') {
          this.status = 'idle';
        }
      }, 2000);
    } catch (err) {
      console.error('[autosave] Save failed:', err);
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : 'Save failed';
    }
  }

  /** Check if a draft exists in localStorage for this video */
  static hasDraft(videoId: string): boolean {
    try {
      return localStorage.getItem(`draft:${videoId}`) !== null;
    } catch {
      return false;
    }
  }

  /** Load draft from localStorage */
  static loadDraft(videoId: string): DraftData | null {
    try {
      const raw = localStorage.getItem(`draft:${videoId}`);
      if (!raw) return null;
      return JSON.parse(raw) as DraftData;
    } catch {
      return null;
    }
  }

  /** Remove draft from localStorage */
  static discardDraft(videoId: string): void {
    try {
      localStorage.removeItem(`draft:${videoId}`);
    } catch {
      // non-fatal
    }
  }

  /** Clean up timers */
  dispose(): void {
    this.#disposed = true;
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    if (this.#savedStatusTimer) {
      clearTimeout(this.#savedStatusTimer);
      this.#savedStatusTimer = null;
    }
  }
}
