<script lang="ts" module>
  /** Display-only task fields that TaskInfo doesn't carry (assigner, due date, brief, feedback byline). */
  export interface TaskDetails {
    assignedBy?: string | null;
    /** Display date, e.g. "2026-09-26" */
    dueDate?: string | null;
    /** Instructions for the annotator */
    brief?: string | null;
    /** Who returned the task with feedback */
    feedbackBy?: string | null;
    /** When it was returned, e.g. "2026-09-22" */
    feedbackAt?: string | null;
  }
</script>

<script lang="ts">
  import type { TaskModeState } from '../state/task-mode.svelte.js';
  import { getTimelineState } from '../context.js';
  import type { ReviewItem, ReviewSelectVia } from '../review.js';
  import type { AnnotationSetType, EditType } from '@annotation/shared';

  interface Props {
    taskMode: TaskModeState;
    details?: TaskDetails | null;
    /** The review queue (buildReviewQueue order); filtered here to the task's review scope */
    queue?: readonly ReviewItem[];
    /** Queue key of the selected item */
    selectedKey?: string | null;
    /** Row activation; `via` tells a pointer click from Enter/Space on the focused row */
    onSelect?: (item: ReviewItem, via: ReviewSelectVia) => void;
    /** Rows in the mini queue */
    maxQueueItems?: number;
  }

  let {
    taskMode,
    details = null,
    queue = [],
    selectedKey = null,
    onSelect,
    maxQueueItems = 4,
  }: Props = $props();

  const timeline = getTimelineState();

  const TASK_TYPE_LABELS: Record<string, string> = {
    tag_session_bounds: 'Tag session bounds',
    verify_states: 'Verify states',
    verify_intents: 'Verify intents',
    tag_backchannels: 'Tag backchannels',
  };

  const headerMeta = $derived.by(() => {
    const parts: string[] = [];
    if (details?.assignedBy) parts.push(`Assigned by ${details.assignedBy}`);
    if (details?.dueDate) parts.push(`due ${details.dueDate}`);
    if (parts.length > 0) return parts.join(' · ');
    return TASK_TYPE_LABELS[taskMode.task?.taskType ?? ''] ?? '';
  });

  /** Same names the TaskToolbar uses */
  const TYPE_LABELS: Record<AnnotationSetType, string> = {
    state: 'States',
    intent: 'Intents',
    backchannel: 'Backchannels',
    transcription: 'Transcription',
    user_labels: 'Labels',
    session_bounds: 'Session bounds',
  };

  const OP_VERBS: Partial<Record<EditType, string>> = {
    confirm: 'confirm',
    classify: 'reclassify',
    resize: 'resize',
    create: 'create',
    split: 'split',
    merge: 'merge',
    delete: 'delete',
  };

  /** "a", "a and b", "a, b and c" */
  function listJoin(items: string[]): string {
    if (items.length <= 1) return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }

  /**
   * Fallback brief when the task carries none, written as a sentence
   * ("Review Intents. You can confirm, reclassify and resize.") rather than
   * the raw constraint enums; the TaskToolbar already lists the constraints.
   */
  const brief = $derived.by(() => {
    if (details?.brief) return details.brief;
    const c = taskMode.constraints;
    if (!c || c.editableTypes.length === 0) return null;
    const parts = [`Review ${listJoin(c.editableTypes.map((t) => TYPE_LABELS[t] ?? t))}.`];
    const verbs = (c.allowedOperations ?? [])
      .map((op) => OP_VERBS[op])
      .filter((v): v is string => !!v);
    if (verbs.length > 0) parts.push(`You can ${listJoin(verbs)}.`);
    if (c.lockedTimeRanges?.length) parts.push("Don't touch locked ranges.");
    return parts.join(' ');
  });

  const feedback = $derived(taskMode.task?.reviewNotes ?? null);
  const feedbackByline = $derived.by(() => {
    const parts: string[] = [];
    if (details?.feedbackAt) parts.push(`Returned ${details.feedbackAt}`);
    else if (taskMode.task?.reviewResult === 'rejected') parts.push('Returned');
    if (details?.feedbackBy) parts.push(details.feedbackBy);
    return parts.length > 0 ? parts.join(' · ') : 'Reviewer feedback';
  });

  const checklist = $derived(taskMode.checklist);
  const lowConfRemaining = $derived(taskMode.lowConfRemaining);

  /** Open queue items in the task's scope, starting at the playhead (or the selection). */
  const miniQueue = $derived.by(() => {
    const scope = taskMode.reviewScope;
    const inScope = queue.filter((q) => (q.kind === 'intent' ? scope.intents : scope.words));
    if (inScope.length <= maxQueueItems) return inScope;
    let from = selectedKey ? inScope.findIndex((q) => q.key === selectedKey) : -1;
    if (from < 0) from = inScope.findIndex((q) => q.end > timeline.currentTime);
    if (from < 0) from = inScope.length - maxQueueItems;
    from = Math.max(0, Math.min(from, inScope.length - maxQueueItems));
    return inScope.slice(from, from + maxQueueItems);
  });

  function hueClass(q: ReviewItem): string {
    if (q.kind === 'intent') return `hue-intent-${q.label}`;
    const m = /(\d+)\s*$/.exec(q.speaker ?? '');
    return `hue-spk-${m ? Number(m[1]) % 2 : 0}`;
  }

  /** MM:SS.s with two-digit minutes. */
  function fmtStart(t: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }
</script>

<section class="h-full min-h-0 min-w-0 flex flex-col bg-viewer-surface text-viewer-text" aria-label="Task">
  <header
    class="h-8 flex-none flex items-center gap-2 px-4 border-b border-viewer-border font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim"
  >
    Task<span class="ornament" aria-hidden="true">◆</span>
    {#if headerMeta}<span class="truncate text-viewer-text-subtle">{headerMeta}</span>{/if}
  </header>

  <div class="flex-1 min-h-0 grid grid-cols-2">
    <!-- Brief + checklist -->
    <div class="min-h-0 overflow-y-auto px-4 py-3.5 flex flex-col gap-3 border-r border-viewer-border">
      {#if taskMode.readOnlyReason}
        <!-- Not the assignee, or a status nobody can work in: no editing, no autosave -->
        <p class="infobox px-3 py-2 bg-viewer-surface-2 text-viewer-base text-viewer-text" role="status" data-task-readonly>
          {taskMode.readOnlyReason}
        </p>
      {/if}
      {#if brief}
        <p class="text-viewer-md text-viewer-text">{brief}</p>
      {/if}

      <div class="flex flex-col gap-2">
        <span class="font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim">Before you submit</span>
        <ul class="flex flex-col gap-2" aria-label="Before you submit">
          {#each checklist as row (row.id)}
            <li class="flex items-center gap-2.5 text-viewer-base whitespace-nowrap {row.done ? 'text-viewer-text-dim' : 'text-viewer-text'}">
              {#if row.applicable}
                <span class="check" data-done={row.done ? '' : undefined} aria-hidden="true">{row.done ? '✓' : ''}</span>
              {:else}
                <!-- Not part of this task (e.g. review rows on a verify-states task) -->
                <span class="check" aria-hidden="true">–</span>
              {/if}
              <span class="truncate">{row.text}</span>
              <span class="sr-only">{!row.applicable ? '(not applicable)' : row.done ? '(done)' : '(to do)'}</span>
              <span class="ml-auto font-mono text-viewer-sm text-viewer-text-dim">{row.meta}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <!-- Feedback + open low-confidence items -->
    <div class="min-h-0 overflow-y-auto px-4 py-3.5 flex flex-col gap-3">
      {#if feedback}
        <div class="infobox px-3 py-2.5 flex flex-col gap-1 bg-viewer-surface-2">
          <span class="font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim">{feedbackByline}</span>
          <span class="text-viewer-base leading-normal">{feedback}</span>
        </div>
      {/if}

      <span class="font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim">
        Low confidence · {lowConfRemaining > 0 ? `${lowConfRemaining} left` : 'none left'}
      </span>

      {#if miniQueue.length > 0}
        <ul class="flex flex-col" aria-label="Open low-confidence items">
          {#each miniQueue as q (q.key)}
            <li>
            <button
              type="button"
              class="qrow w-full h-[26px] flex items-center gap-2.5 px-2 border-b border-viewer-border text-viewer-base text-left"
              aria-current={q.key === selectedKey ? 'true' : undefined}
              onclick={(e) => onSelect?.(q, e.detail > 0 ? 'pointer' : 'keyboard')}
            >
              <span class="sw blk {hueClass(q)}" data-lowconf data-source="ai" aria-hidden="true"></span>
              <span class="truncate">{q.kind === 'word' ? `“${q.label}”` : q.label}</span>
              <span class="ml-auto font-mono text-viewer-sm text-viewer-text-dim">{fmtStart(q.start)}</span>
              <span class="w-7 text-right font-mono text-viewer-sm">{q.confidence.toFixed(2)}</span>
            </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-viewer-base text-viewer-text-dim">Every low-confidence item is resolved.</p>
      {/if}
    </div>
  </div>
</section>

<style>
  .ornament {
    color: var(--viewer-ornament);
  }

  .check {
    width: 14px;
    height: 14px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
    font-size: 10px;
    line-height: 1;
    color: var(--viewer-accent-fg);
  }

  .check[data-done] {
    border-color: var(--viewer-accent);
    background: var(--viewer-accent);
  }

  /* InfoBox: 4px amber left rule on an inset surface */
  .infobox {
    border: 1px solid var(--viewer-border);
    border-left: 4px solid var(--viewer-ornament);
  }

  .qrow {
    transition: background-color 150ms;
  }

  .qrow:hover {
    background: var(--viewer-accent-bg);
  }

  .qrow[aria-current='true'] {
    background: var(--viewer-accent-bg);
    outline: 2px solid var(--viewer-accent);
    outline-offset: -2px;
  }

  .sw {
    width: 8px;
    height: 8px;
    flex: none;
  }
</style>
