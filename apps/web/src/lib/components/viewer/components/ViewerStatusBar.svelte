<script module lang="ts">
  export interface StatusSelection {
    /** Singular track noun: "intent", "word", "state", "label", "backchannel" */
    kind: string;
    /** 0-based index in its track (shown 1-based as "#12") */
    index: number;
    start: number;
    end: number;
  }
</script>

<script lang="ts">
  import { getTimelineState } from '../context.js';
  import type { ViewerMode } from '../state/tracks.svelte.js';

  /**
   * 24px mono status bar: mode · window range · selection, with
   * context-aware shortcut hints on the right (copy from timeline-screen.html).
   */
  interface Props {
    mode: ViewerMode;
    /** Task type, e.g. "verify_intents" → "TASK · verify intents" */
    taskType?: string | null;
    /** Edit mode: "EDIT · autosave on" / "off" */
    autosave?: boolean;
    selection?: StatusSelection | null;
    /** Override the right-hand hints */
    hints?: string;
  }

  let { mode, taskType = null, autosave = true, selection = null, hints }: Props = $props();

  const timeline = getTimelineState();

  const HINTS: Record<ViewerMode, string> = {
    // ⇥ steps the review queue once a queue row is picked (focus on the viewer); on a block it moves to the next track
    view: 'SPACE play · ←/→ 1 s · ⇥ next in review (from queue) · ⌘E edit · ? shortcuts',
    edit: 'drag edges to resize · ←/→ blocks · ⇥ next track · ↵ confirm · ⌘Z undo · ? shortcuts',
    task: '⇥ next unreviewed (from queue) · ↵ confirm · C reclassify · ⌘↵ submit · ? shortcuts',
  };

  /** MM:SS.fff with a zero-padded minute, as in the design ("00:42.000") */
  function fmt(t: number): string {
    const safe = Math.max(0, t);
    const m = Math.floor(safe / 60);
    const s = safe - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }

  const modeText = $derived(
    mode === 'view'
      ? 'VIEW'
      : mode === 'edit'
        ? `EDIT · autosave ${autosave ? 'on' : 'off'}`
        : `TASK${taskType ? ` · ${taskType.replace(/_/g, ' ')}` : ''}`,
  );

  const windowText = $derived(
    timeline.duration > 0 ? `Window ${fmt(timeline.viewStartTime)} – ${fmt(Math.min(timeline.viewEndTime, timeline.duration))}` : '',
  );

  const selectionText = $derived(
    selection
      ? `Selected ${selection.kind} #${selection.index + 1} · ${fmt(selection.start)} – ${fmt(selection.end)}`
      : '',
  );

  const hintText = $derived(hints ?? HINTS[mode]);
</script>

<div
  class="flex shrink-0 items-center gap-4 px-3 bg-viewer-bg border-t border-viewer-border font-mono text-viewer-xs tracking-wider text-viewer-text-dim whitespace-nowrap overflow-hidden"
  style="height: 24px"
>
  <span>{modeText}</span>
  {#if windowText}
    <span class="status-sep" aria-hidden="true">·</span>
    <span>{windowText}</span>
  {/if}
  {#if selectionText}
    <span class="status-sep" aria-hidden="true">·</span>
    <span>{selectionText}</span>
  {/if}
  <div class="flex-1"></div>
  <span class="text-viewer-text-subtle truncate">{hintText}</span>
</div>

<style>
  .status-sep {
    color: var(--viewer-ornament);
  }
</style>
