<script lang="ts">
  import type { TaskModeState } from '../state/task-mode.svelte.js';
  import { formatTimePrecise } from '../utils/format-time.js';

  interface Props {
    taskMode: TaskModeState;
    onSubmit: () => void;
  }

  let { taskMode, onSubmit }: Props = $props();

  const taskTypeLabels: Record<string, string> = {
    tag_session_bounds: 'Tag Session Bounds',
    verify_states: 'Verify States',
    verify_intents: 'Verify Intents',
    tag_backchannels: 'Tag Backchannels',
  };

  const elapsedFormatted = $derived(formatElapsed(taskMode.elapsedSecs));

  function formatElapsed(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<div class="flex flex-col gap-3 p-3 h-full overflow-y-auto">
  <!-- Task header -->
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-medium text-viewer-text">
      {taskTypeLabels[taskMode.task?.taskType ?? ''] ?? 'Task'}
    </h3>
    <span class="text-viewer-sm tabular-nums text-viewer-text-dim">
      {elapsedFormatted}
    </span>
  </div>

  <!-- Constraints summary -->
  {#if taskMode.constraints}
    <div class="space-y-1.5">
      <div class="text-viewer-sm text-viewer-text-dim">
        Editable: {taskMode.constraints.editableTypes.join(', ')}
      </div>
      {#if taskMode.constraints.allowedOperations}
        <div class="text-viewer-sm text-viewer-text-dim">
          Operations: {taskMode.constraints.allowedOperations.join(', ')}
        </div>
      {/if}
      {#if taskMode.constraints.allowedCategories}
        <div class="text-viewer-sm text-viewer-text-dim">
          Categories: {taskMode.constraints.allowedCategories.join(', ')}
        </div>
      {/if}
      {#if taskMode.constraints.lockedTimeRanges && taskMode.constraints.lockedTimeRanges.length > 0}
        <div class="text-viewer-sm text-amber-400">
          {taskMode.constraints.lockedTimeRanges.length} locked region{taskMode.constraints.lockedTimeRanges.length > 1 ? 's' : ''}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Rejection notes (if task was previously rejected) -->
  {#if taskMode.task?.reviewResult === 'rejected' && taskMode.task.reviewNotes}
    <div class="p-2 rounded bg-red-900/20 border border-red-800/30">
      <div class="text-viewer-sm font-medium text-red-400 mb-1">Reviewer feedback</div>
      <div class="text-viewer-sm text-red-300">{taskMode.task.reviewNotes}</div>
    </div>
  {/if}

  <!-- Stats -->
  <div class="flex items-center gap-4 text-viewer-sm text-viewer-text-dim">
    <span>Edits: <span class="text-viewer-text tabular-nums">{taskMode.editCount}</span></span>
  </div>

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- Submit button -->
  <button
    onclick={onSubmit}
    disabled={taskMode.submitted}
    class="w-full py-2 px-4 rounded text-sm font-medium transition-colors {taskMode.submitted
      ? 'bg-green-900/30 text-green-400 cursor-not-allowed'
      : 'bg-indigo-600 text-white hover:bg-indigo-500'}"
  >
    {taskMode.submitted ? 'Submitted' : 'Submit for Review'}
  </button>
</div>
