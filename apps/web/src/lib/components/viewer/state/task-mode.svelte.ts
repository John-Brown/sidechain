/**
 * Task mode state — activated when viewer loads with ?taskId=xxx.
 *
 * Manages: active task, parsed constraints, elapsed time tracking,
 * allowed operations check, and submission flow.
 */

import type { TaskConstraints, AnnotationSetType, EditType, TimeRange } from '@annotation/shared';

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
