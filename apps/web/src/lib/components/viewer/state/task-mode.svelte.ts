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
  hasReviewScope,
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

/**
 * Which review kinds a task covers: intents and/or words, whichever it may
 * edit. A task that can edit neither (verify states, backchannels, session
 * bounds) reviews nothing, since it couldn't confirm those items anyway. Only
 * a task with no constraints at all falls back to both.
 */
export function reviewScopeFor(constraints: TaskConstraints | null): ReviewScope {
  if (!constraints) return { intents: true, words: true };
  const types = constraints.editableTypes ?? [];
  return { intents: types.includes('intent'), words: types.includes('transcription') };
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
  /** profiles.id of the assignee (null: unassigned) */
  assignedTo?: string | null;
  /** Assignee display name, for the read-only note */
  assigneeName?: string | null;
}

/** Statuses the assignee can work in: `assigned` is started (→ in_progress) when the viewer opens it. */
const WORKABLE_STATUSES = ['assigned', 'in_progress'];

export interface TaskAccess {
  /** The viewer may edit and autosave with this task's id */
  editable: boolean;
  /** Why not, as the note TaskPanel shows ("Read-only: assigned to Dana", "Task is submitted"); null when editable */
  reason: string | null;
}

/**
 * Whether the signed-in user may work on the task: they are its assignee and
 * it is `assigned` (the viewer starts it) or `in_progress` (a rejected task
 * returns to in_progress). Anyone else, e.g. a supervisor opening a submitted
 * or someone else's `?taskId=` link, gets the task read-only: the server
 * would refuse every save anyway (assertTaskAllowsSave).
 */
export function taskAccessFor(
  task: Pick<TaskInfo, 'status' | 'assignedTo' | 'assigneeName'>,
  userId: string | null,
): TaskAccess {
  if (!WORKABLE_STATUSES.includes(task.status)) {
    return { editable: false, reason: `Task is ${task.status.replace(/_/g, ' ')}` };
  }
  if (!task.assignedTo) return { editable: false, reason: 'Read-only: not assigned to anyone' };
  if (!userId || task.assignedTo !== userId) {
    return { editable: false, reason: `Read-only: assigned to ${task.assigneeName || 'someone else'}` };
  }
  return { editable: true, reason: null };
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

  /**
   * Set when the task opened read-only (not the assignee, or a status nobody
   * can work in): the note TaskPanel shows. See taskAccessFor.
   */
  readOnlyReason: string | null = $state(null);

  /**
   * True while the user may edit this task: active, opened editable and not
   * yet submitted. Only then does autosave send the task id.
   */
  get editable(): boolean {
    return this.active && this.readOnlyReason === null && !this.submitted;
  }

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

  /** False when the task reviews neither intents nor words (review counters read N/A). */
  get hasReviewScope(): boolean {
    return hasReviewScope(this.reviewScope);
  }

  /** Review counters over the connected data, skipping locked ranges; zeros when not connected. */
  get reviewProgress(): ReviewProgress {
    const src = this.#reviewSource?.();
    if (!src) {
      return { reviewedCount: 0, totalReviewable: 0, lowConfRemaining: 0, intentsReviewed: 0, intentsTotal: 0 };
    }
    return computeReviewProgress({ ...src.current, lockedRanges: this.lockedTimeRanges }, this.reviewScope);
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

  /**
   * Initialize task mode with task data. `readOnlyReason` (see taskAccessFor)
   * opens it read-only: no editing, no autosave, no timer.
   */
  activate(task: TaskInfo, opts: { readOnlyReason?: string | null } = {}): void {
    this.task = task;
    this.constraints = task.constraints;
    this.active = true;
    this.submitted = false;
    this.editCount = 0;
    this.readOnlyReason = opts.readOnlyReason ?? null;
    if (this.readOnlyReason === null) this.startTimer();
  }

  /** Deactivate task mode */
  deactivate(): void {
    this.stopTimer();
    this.task = null;
    this.constraints = null;
    this.active = false;
    this.submitted = false;
    this.editCount = 0;
    this.readOnlyReason = null;
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
    this.readOnlyReason = 'Task is submitted';
    this.stopTimer();
  }

  /** Clean up */
  dispose(): void {
    this.stopTimer();
  }
}
