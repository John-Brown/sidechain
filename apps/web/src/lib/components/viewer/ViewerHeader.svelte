<script lang="ts">
  import { browser } from '$app/environment';
  import { Slider } from 'bits-ui';
  import { getTimelineState, getSessionState, getEditorState } from './context.js';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import SaveIndicator from './components/SaveIndicator.svelte';
  import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp.svelte';
  import type { AutoSaveState } from './state/autosave.svelte.js';
  import type { TaskModeState } from './state/task-mode.svelte.js';

  interface Props {
    onTogglePlay: () => void;
    onTogglePip: () => void;
    onToggleEditMode: () => void;
    /** Task variant only: the one Submit button (⌘↵). */
    onTaskSubmit?: () => void;
    /** Task variant only: "Exit task". Without it the button links to backHref. */
    onExitTask?: () => void;
    autosave: AutoSaveState;
    /** Pass the TaskModeState when a task is active; null selects the view/edit variant. */
    taskMode: TaskModeState | null;
    showShortcutsHelp: boolean;
    onToggleShortcutsHelp: () => void;
    /** Project name shown in mono uppercase after the wordmark. Hidden when empty. */
    projectName?: string | null;
    /** Back / exit target. Defaults to /videos/{videoId}. */
    backHref?: string;
    /** Task title (serif). Defaults to a label derived from the task type. */
    taskTitle?: string | null;
    /** Short task reference shown after ◆ (e.g. T-0192). Defaults to the task id. */
    taskRef?: string | null;
  }

  let {
    onTogglePlay,
    onTogglePip,
    onToggleEditMode,
    onTaskSubmit,
    onExitTask,
    autosave,
    taskMode = null,
    showShortcutsHelp,
    onToggleShortcutsHelp,
    projectName = null,
    backHref,
    taskTitle = null,
    taskRef = null,
  }: Props = $props();

  const timeline = getTimelineState();
  const session = getSessionState();
  const editor = getEditorState();

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 100;
  const ZOOM_STEP = 1.25;

  const isMac = browser && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl+';

  const TASK_TYPE_TITLES: Record<string, string> = {
    tag_session_bounds: 'Tag session bounds',
    verify_states: 'Verify states',
    verify_intents: 'Verify intents',
    tag_backchannels: 'Tag backchannels',
  };

  const isTask = $derived(!!taskMode?.active);
  const href = $derived(backHref ?? `/videos/${session.videoId}`);
  const title = $derived(taskTitle ?? TASK_TYPE_TITLES[taskMode?.task?.taskType ?? ''] ?? 'Task');
  const ref = $derived(taskRef ?? taskMode?.task?.id ?? '');

  const reviewed = $derived(taskMode?.reviewedCount ?? 0);
  const reviewable = $derived(taskMode?.totalReviewable ?? 0);
  const lowConfLeft = $derived(taskMode?.lowConfRemaining ?? 0);
  const reviewedPct = $derived(reviewable > 0 ? Math.min(100, (reviewed / reviewable) * 100) : 0);
  const edits = $derived(taskMode?.editCount ?? 0);

  /** MM:SS.fff with two-digit minutes (header timecode). */
  function timecode(secs: number): string {
    const safe = Number.isFinite(secs) ? Math.max(0, secs) : 0;
    const m = Math.floor(safe / 60);
    const s = safe - m * 60;
    return `${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }

  /** MM:SS elapsed task time. */
  function elapsed(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // Zoom slider runs on a log scale so the low end (whole-video) stays usable.
  const LOG_MIN = Math.log(ZOOM_MIN);
  const LOG_SPAN = Math.log(ZOOM_MAX) - LOG_MIN;
  const zoomPos = $derived(
    Math.round(((Math.log(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, timeline.zoom))) - LOG_MIN) / LOG_SPAN) * 1000),
  );
  const zoomLabel = $derived(timeline.zoom >= 10 ? Math.round(timeline.zoom).toString() : timeline.zoom.toFixed(1));

  function setZoom(pxPerSec: number) {
    timeline.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pxPerSec));
  }

  /** Slider position 0–1000 → px/s on the log scale */
  function setZoomPos(pos: number) {
    setZoom(Math.exp(LOG_MIN + (pos / 1000) * LOG_SPAN));
  }

  function setMode(edit: boolean) {
    if (edit !== editor.editing) onToggleEditMode();
  }
</script>

<header class="viewer-header" data-mode={isTask ? 'task' : editor.editing ? 'edit' : 'view'}>
  <!-- Identity -->
  <div class="hdr-group hdr-identity">
    {#if isTask}
      {#if onExitTask}
        <button type="button" class="hdr-exit" onclick={onExitTask}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          Exit task
        </button>
      {:else}
        <a {href} class="hdr-exit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          Exit task
        </a>
      {/if}
      <span class="hdr-serif">{title}</span>
      <span class="hdr-ornament" aria-hidden="true">◆</span>
      {#if ref}<span class="hdr-mono-label">{ref}</span>{/if}
    {:else}
      <a {href} class="hdr-icon-btn hdr-bordered" aria-label="Back to video" title="Back to video">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      </a>
      <span class="hdr-serif">Sidechain</span>
      <span class="hdr-ornament" aria-hidden="true">◆</span>
      {#if projectName}<span class="hdr-mono-label truncate">{projectName}</span>{/if}
    {/if}
    {#if session.filename}
      <span class="hdr-slash" aria-hidden="true">/</span>
      <span class="hdr-filename truncate" title={session.filename}>{session.filename}</span>
    {/if}
  </div>

  <div class="flex-1"></div>

  <!-- Transport -->
  <div class="hdr-group hdr-transport">
    <button
      type="button"
      class="hdr-play"
      onclick={onTogglePlay}
      aria-label={timeline.playing ? 'Pause (Space)' : 'Play (Space)'}
      title={timeline.playing ? 'Pause (Space)' : 'Play (Space)'}
    >
      {#if timeline.playing}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3" /></svg>
      {/if}
    </button>
    <div class="hdr-timecode">
      <span class="hdr-time-current">{timecode(timeline.currentTime)}</span>
      <span class="hdr-time-total">/ {timecode(timeline.duration)}</span>
    </div>
  </div>

  <div class="hdr-divider" aria-hidden="true"></div>

  {#if isTask && taskMode}
    <!-- Task progress -->
    <div class="hdr-group hdr-progress">
      <span class="hdr-mono-caption" id="hdr-reviewed-label">Reviewed</span>
      <div
        class="hdr-progress-track"
        role="progressbar"
        aria-labelledby="hdr-reviewed-label"
        aria-valuemin={0}
        aria-valuemax={reviewable}
        aria-valuenow={reviewed}
      >
        <div class="hdr-progress-fill" style="width: {reviewedPct}%"></div>
      </div>
      <span class="hdr-count">{reviewed} / {reviewable}</span>
      <span class="hdr-lowconf">
        {lowConfLeft === 0 ? 'No low-confidence left' : `${lowConfLeft} low-confidence left`}
      </span>
    </div>

    <div class="hdr-divider" aria-hidden="true"></div>

    <div class="hdr-group hdr-timer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
      <span title="Time on task">{elapsed(taskMode.elapsedSecs)}</span>
      <span class="hdr-sep" aria-hidden="true">·</span>
      <span>{edits} {edits === 1 ? 'edit' : 'edits'}</span>
    </div>
  {:else}
    <!-- View | Edit -->
    <div class="hdr-segmented" role="group" aria-label="Mode">
      <button
        type="button"
        class="hdr-seg"
        aria-pressed={!editor.editing}
        onclick={() => setMode(false)}
        title="View mode ({mod}E)"
      >
        View
      </button>
      <button
        type="button"
        class="hdr-seg hdr-seg-edit"
        aria-pressed={editor.editing}
        onclick={() => setMode(true)}
        title="Edit mode ({mod}E)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></svg>
        {editor.editing ? 'Editing' : 'Edit'}
        <span class="hdr-seg-key" aria-hidden="true">{mod}E</span>
      </button>
    </div>
  {/if}

  <div class="flex-1"></div>

  {#if isTask || editor.editing}
    <SaveIndicator {autosave} />
  {/if}

  {#if isTask && taskMode}
    <button
      type="button"
      class="hdr-submit"
      onclick={onTaskSubmit}
      disabled={taskMode.submitted || !onTaskSubmit}
      title="Submit for review ({mod}↵)"
    >
      {#if taskMode.submitted}
        Submitted
      {:else}
        Submit for review <span class="hdr-submit-key" aria-hidden="true">{mod}↵</span>
      {/if}
    </button>
  {:else}
    <button
      type="button"
      class="hdr-text-btn"
      aria-pressed={session.normalized}
      onclick={() => (session.normalized = !session.normalized)}
      title="Normalize track scales to fit the data range (N)"
    >
      Normalize <span class="hdr-text-key" aria-hidden="true">N</span>
    </button>

    <!-- Zoom, in px/s (timeline.zoom is px per second) -->
    <div class="hdr-group hdr-zoom">
      <button
        type="button"
        class="hdr-zoom-btn"
        onclick={() => setZoom(timeline.zoom / ZOOM_STEP)}
        disabled={timeline.zoom <= ZOOM_MIN}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <!-- bits-ui Slider, same recipe as the mesh opacity slider: 96px 2px rail, 10px square thumb -->
      <Slider.Root
        type="single"
        bind:value={() => zoomPos, setZoomPos}
        min={0}
        max={1000}
        step={1}
        class="hdr-zoom-slider relative flex items-center touch-none select-none"
      >
        <span class="slider-track absolute inset-x-0 top-1 h-0.5"></span>
        <Slider.Range class="slider-range top-1 h-0.5" />
        <Slider.Thumb
          index={0}
          class="slider-thumb top-0 block size-2.5 rounded-sm"
          aria-label="Zoom"
          aria-valuetext="{zoomLabel} pixels per second"
        />
      </Slider.Root>
      <button
        type="button"
        class="hdr-zoom-btn"
        onclick={() => setZoom(timeline.zoom * ZOOM_STEP)}
        disabled={timeline.zoom >= ZOOM_MAX}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
      </button>
      <span class="hdr-zoom-value">{zoomLabel} px/s</span>
    </div>
  {/if}

  <div class="hdr-divider" aria-hidden="true"></div>

  <!-- Utilities -->
  <div class="hdr-group hdr-utilities">
    <ThemeToggle />
    <button
      type="button"
      class="hdr-icon-btn"
      aria-pressed={showShortcutsHelp}
      onclick={onToggleShortcutsHelp}
      aria-label="Keyboard shortcuts (?)"
      title="Keyboard shortcuts (?)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10M8 12h.01" /><rect width="20" height="16" x="2" y="4" rx="2" /></svg>
    </button>
    {#if session.pipSupported}
      <button
        type="button"
        class="hdr-icon-btn"
        aria-pressed={session.pipActive}
        onclick={onTogglePip}
        aria-label={session.pipActive ? 'Exit picture-in-picture (P)' : 'Picture-in-picture (P)'}
        title={session.pipActive ? 'Exit picture-in-picture (P)' : 'Picture-in-picture (P)'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" /><rect width="10" height="7" x="12" y="13" rx="2" /></svg>
      </button>
    {/if}
  </div>
</header>

{#if showShortcutsHelp}
  <KeyboardShortcutsHelp onClose={onToggleShortcutsHelp} />
{/if}

<style>
  .viewer-header {
    height: 48px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    box-sizing: border-box;
    white-space: nowrap;
    background-color: var(--viewer-surface);
    border-bottom: 1px solid var(--viewer-border);
    color: var(--viewer-text);
  }

  .hdr-group {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .hdr-divider {
    flex: none;
    width: 1px;
    height: 24px;
    background-color: var(--viewer-border);
  }

  /* --- Identity --- */
  .hdr-identity {
    flex: 0 1 auto;
  }

  .hdr-serif {
    font-family: var(--font-serif);
    font-size: 19px;
    line-height: 1;
    color: var(--viewer-text);
  }

  .hdr-ornament {
    color: var(--viewer-ornament);
    font-size: 9px;
  }

  .hdr-mono-label {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--viewer-text-dim);
    min-width: 0;
  }

  .hdr-slash {
    color: var(--viewer-text-subtle);
    font-size: 13px;
  }

  .hdr-filename {
    font-size: 13px;
    color: var(--viewer-text);
    min-width: 0;
    max-width: 280px;
  }

  .hdr-exit {
    height: 28px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px 0 6px;
    box-sizing: border-box;
    color: var(--viewer-text-dim);
    background: transparent;
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      color 150ms ease,
      border-color 150ms ease;
  }

  .hdr-exit:hover {
    color: var(--viewer-text);
    border-color: var(--viewer-accent);
  }

  /* --- Icon buttons --- */
  .hdr-icon-btn {
    width: 28px;
    height: 28px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    color: var(--viewer-text-dim);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    cursor: pointer;
    transition:
      color 150ms ease,
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .hdr-icon-btn.hdr-bordered {
    border-color: var(--viewer-border);
  }

  .hdr-icon-btn:hover {
    color: var(--viewer-text);
    background-color: var(--viewer-accent-bg);
  }

  .hdr-icon-btn[aria-pressed='true'] {
    color: var(--viewer-accent);
  }

  .hdr-utilities {
    gap: 2px;
    color: var(--viewer-text-dim);
  }

  /* --- Transport --- */
  .hdr-transport {
    flex: none;
  }

  .hdr-play {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    color: var(--viewer-text);
    background: transparent;
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
    cursor: pointer;
    transition:
      color 150ms ease,
      border-color 150ms ease;
  }

  .hdr-play:hover {
    color: var(--viewer-accent);
    border-color: var(--viewer-accent);
  }

  .hdr-timecode {
    display: flex;
    align-items: baseline;
    gap: 4px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .hdr-time-current {
    font-size: 15px;
    color: var(--viewer-text);
  }

  .hdr-time-total {
    font-size: 12px;
    color: var(--viewer-text-subtle);
  }

  /* --- View | Edit segmented control --- */
  .hdr-segmented {
    flex: none;
    display: flex;
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .hdr-seg {
    height: 26px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    color: var(--viewer-text-dim);
    background: transparent;
    border: 0;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
    transition:
      color 150ms ease,
      background-color 150ms ease;
  }

  .hdr-seg + .hdr-seg {
    border-left: 1px solid var(--viewer-border);
  }

  .hdr-seg:hover {
    color: var(--viewer-text);
  }

  .hdr-seg[aria-pressed='true'] {
    background-color: var(--viewer-surface-2);
    color: var(--viewer-text);
  }

  .hdr-seg-edit[aria-pressed='true'] {
    background-color: var(--viewer-accent);
    color: var(--viewer-accent-fg);
  }

  .hdr-seg-edit[aria-pressed='true']:hover {
    background-color: var(--viewer-accent-hover);
  }

  .hdr-seg-key {
    opacity: 0.7;
  }

  .hdr-seg:focus-visible {
    outline-offset: -2px;
  }

  /* --- Task progress --- */
  .hdr-mono-caption {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--viewer-text-subtle);
  }

  .hdr-progress-track {
    position: relative;
    width: 180px;
    height: 4px;
    flex: none;
    background-color: var(--viewer-surface-2);
    border: 1px solid var(--viewer-border);
  }

  .hdr-progress-fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background-color: var(--viewer-accent);
  }

  .hdr-count {
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .hdr-lowconf {
    font-size: 12px;
    color: var(--viewer-text-dim);
  }

  .hdr-timer {
    gap: 6px;
    color: var(--viewer-text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .hdr-sep {
    color: var(--viewer-text-subtle);
  }

  /* --- Submit (task) --- */
  .hdr-submit {
    height: 32px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background-color: var(--viewer-accent);
    color: var(--viewer-accent-fg);
    border: 0;
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background-color 150ms ease;
  }

  .hdr-submit:hover:not(:disabled) {
    background-color: var(--viewer-accent-hover);
  }

  .hdr-submit:disabled {
    background-color: var(--viewer-surface-2);
    color: var(--viewer-text-dim);
    cursor: not-allowed;
  }

  .hdr-submit-key {
    opacity: 0.75;
  }

  /* --- Normalize --- */
  .hdr-text-btn {
    height: 28px;
    flex: none;
    display: flex;
    align-items: center;
    padding: 0 10px;
    box-sizing: border-box;
    color: var(--viewer-text-dim);
    background: transparent;
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      color 150ms ease,
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .hdr-text-btn:hover {
    color: var(--viewer-text);
  }

  .hdr-text-btn[aria-pressed='true'] {
    color: var(--viewer-accent);
    border-color: var(--viewer-accent);
    background-color: var(--viewer-accent-bg);
  }

  .hdr-text-key {
    margin-left: 6px;
    color: var(--viewer-text-subtle);
  }

  /* --- Zoom --- */
  .hdr-zoom {
    flex: none;
    gap: 8px;
    color: var(--viewer-text-dim);
  }

  .hdr-zoom-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
    transition: color 150ms ease;
  }

  .hdr-zoom-btn:hover:not(:disabled) {
    color: var(--viewer-accent);
  }

  .hdr-zoom-btn:disabled {
    color: var(--viewer-text-subtle);
    cursor: default;
  }

  /* 96px, 2px rail with a teal fill to the 10px square thumb */
  .hdr-zoom :global(.hdr-zoom-slider) {
    width: 96px;
    height: 10px;
    cursor: pointer;
  }

  .hdr-zoom :global(.slider-track) {
    background: var(--viewer-border);
  }

  .hdr-zoom :global(.slider-range) {
    background: var(--viewer-accent);
  }

  .hdr-zoom :global(.slider-thumb) {
    background: var(--viewer-accent);
    cursor: grab;
    transition: background-color 150ms;
  }

  .hdr-zoom :global(.slider-thumb:hover) {
    background: var(--viewer-accent-hover);
  }

  .hdr-zoom :global(.slider-thumb:focus-visible) {
    outline: 2px solid var(--viewer-accent);
    outline-offset: 2px;
  }

  .hdr-zoom-value {
    width: 56px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--viewer-text);
  }

  .viewer-header a:focus-visible {
    outline: 2px solid var(--viewer-accent);
    outline-offset: 1px;
  }
</style>
