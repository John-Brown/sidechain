/**
 * Task mode state — activated when viewer loads with ?taskId=xxx.
 *
 * Manages: active task, parsed constraints, elapsed time tracking,
 * allowed operations check, and submission flow.
 */

import type { TaskConstraints, AnnotationSetType, EditType, TimeRange } from '@annotation/shared';
import {
  buildTaskChecklist,
  computeReviewProgress,
  type ChecklistItem,
  type ChecklistTracks,
  type ReviewProgress,
  type ReviewScope,
} from '../review.js';

/** Data the review counters and checklist read. Wire with TaskModeState.connectReview(). */
export interface TaskReviewSource {
  /** Current data: editor arrays while editing, else the loaded annotations */
  current: ChecklistTracks;
  /** Data as loaded, before this session's edits (locked-range check) */
  baseline?: ChecklistTracks;
}

/** annotation_set type → checklist track */
const SET_TYPE_TO_TRACK: Partial<Record<AnnotationSetType, keyof ChecklistTracks>> = {
  intent: 'intents',
  transcription: 'words',
  state: 'states',
  backchannel: 'backchannels',
};

/** Which review kinds a task covers. No constraints (or no reviewable types) → both. */
export function reviewScopeFor(constraints: TaskConstraints | null): ReviewScope {
  const types = constraints?.editableTypes ?? [];
  const scope = { intents: types.includes('intent'), words: types.includes('transcription') };
  if (!scope.intents && !scope.words) return { intents: true, words: true };
  return scope;
}

/** Tracks the "No overlaps" row checks: the task's editable types, or intents by default. */
export function overlapTracksFor(constraints: TaskConstraints | null): (keyof ChecklistTracks)[] {
  const tracks = (constraints?.editableTypes ?? [])
    .map((t) => SET_TYPE_TO_TRACK[t])
    .filter((t): t is keyof ChecklistTracks => t !== undefined);
  return tracks.length > 0 ? [...new Set(tracks)] : ['intents'];
}

export interface TaskInfo {
  id: string;
  videoId: string;
  taskType: string;
  status: string;
  constraints: TaskConstraints | null;
  reviewNotes: string | null;
  reviewResult: string | null;
}

export class TaskModeState {
  /** Whether task mode is active */
  active = $state(false);

  /** The current task (null if not in task mode) */
  task: TaskInfo | null = $state(null);

  /** Parsed constraints from the task */
  constraints: TaskConstraints | null = $state(null);

  /** Elapsed time in seconds since task was started */
  elapsedSecs = $state(0);

  /** Number of edits made in this session */
  editCount = $state(0);

  /** Whether the task has been submitted */
  submitted = $state(false);

  #timerInterval: ReturnType<typeof setInterval> | null = null;
  #startTime: number | null = null;

  // Getter over reactive viewer state; $state.raw so re-connecting re-runs dependents
  #reviewSource: (() => TaskReviewSource) | null = $state.raw(null);

  /**
   * Point the review counters and checklist at the viewer's data, e.g.
   * `taskMode.connectReview(() => ({ current: { intents: editor.intents ?? annotations.intentClassification?.data }, baseline: {...} }))`.
   * The getter is re-read on every access, so reads stay reactive.
   */
  connectReview(source: (() => TaskReviewSource) | null): void {
    this.#reviewSource = source;
  }

  /** Review kinds this task covers (intents and/or words). */
  get reviewScope(): ReviewScope {
    return reviewScopeFor(this.constraints);
  }

  /** Review counters over the connected data; zeros when not connected. */
  get reviewProgress(): ReviewProgress {
    const src = this.#reviewSource?.();
    if (!src) {
      return { reviewedCount: 0, totalReviewable: 0, lowConfRemaining: 0, intentsReviewed: 0, intentsTotal: 0 };
    }
    return computeReviewProgress(src.current, this.reviewScope);
  }

  /** Items a human has confirmed/decided on (see review.ts computeReviewProgress). */
  get reviewedCount(): number {
    return this.reviewProgress.reviewedCount;
  }

  /** All intents in scope plus flagged/reviewed words. */
  get totalReviewable(): number {
    return this.reviewProgress.totalReviewable;
  }

  /** Low-confidence AI items still unreviewed (the queue length within scope). */
  get lowConfRemaining(): number {
    return this.reviewProgress.lowConfRemaining;
  }

  /** "Before you submit" rows: all reviewed, low-confidence resolved, no overlaps, locked untouched. */
  get checklist(): ChecklistItem[] {
    const src = this.#reviewSource?.();
    return buildTaskChecklist({
      current: src?.current ?? {},
      baseline: src?.baseline,
      scope: this.reviewScope,
      overlapTracks: overlapTracksFor(this.constraints),
      lockedRanges: this.lockedTimeRanges,
    });
  }

  /** True when every checklist row is done. */
  get checklistComplete(): boolean {
    return this.checklist.every((row) => row.done);
  }

  /** Initialize task mode with task data */
  activate(task: TaskInfo): void {
    this.task = task;
    this.constraints = task.constraints;
    this.active = true;
    this.submitted = false;
    this.editCount = 0;
    this.startTimer();
  }

  /** Deactivate task mode */
  deactivate(): void {
    this.stopTimer();
    this.task = null;
    this.constraints = null;
    this.active = false;
    this.submitted = false;
    this.editCount = 0;
  }

  /** Start the elapsed time timer */
  startTimer(): void {
    this.#startTime = performance.now();
    this.#timerInterval = setInterval(() => {
      if (this.#startTime) {
        this.elapsedSecs = (performance.now() - this.#startTime) / 1000;
      }
    }, 1000);
  }

  /** Stop the timer */
  stopTimer(): void {
    if (this.#timerInterval) {
      clearInterval(this.#timerInterval);
      this.#timerInterval = null;
    }
    this.#startTime = null;
    this.elapsedSecs = 0;
  }

  /** Check if a given annotation type is editable in this task */
  isTypeEditable(type: AnnotationSetType): boolean {
    if (!this.active || !this.constraints) return false;
    return this.constraints.editableTypes.includes(type);
  }

  /** Check if a given edit operation is allowed in this task */
  isOperationAllowed(operation: EditType): boolean {
    if (!this.active || !this.constraints) return true;
    if (!this.constraints.allowedOperations) return true;
    return this.constraints.allowedOperations.includes(operation);
  }

  /** Check if a given category is allowed in this task */
  isCategoryAllowed(category: string): boolean {
    if (!this.active || !this.constraints) return true;
    if (!this.constraints.allowedCategories) return true;
    return this.constraints.allowedCategories.includes(category);
  }

  /** Check if a time range overlaps with any locked time range */
  isTimeLocked(range: TimeRange): boolean {
    if (!this.active || !this.constraints?.lockedTimeRanges) return false;
    return this.constraints.lockedTimeRanges.some(
      (locked) => range.start < locked.end && range.end > locked.start,
    );
  }

  /** Get the locked time ranges (for rendering overlays) */
  get lockedTimeRanges(): TimeRange[] {
    return this.constraints?.lockedTimeRanges ?? [];
  }

  /** Increment edit count */
  recordEdit(): void {
    this.editCount++;
  }

  /** Mark as submitted */
  markSubmitted(): void {
    this.submitted = true;
    this.stopTimer();
  }

  /** Clean up */
  dispose(): void {
    this.stopTimer();
  }
}
