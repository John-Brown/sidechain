<script lang="ts">
  import { getTimelineState, getSessionState, getEditorState, getAnnotationDataState } from './context.js';
  import { formatTimePrecise } from './utils/format-time.js';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import SaveIndicator from './components/SaveIndicator.svelte';
  import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp.svelte';
  import type { AutoSaveState } from './state/autosave.svelte.js';
  import type { TaskModeState } from './state/task-mode.svelte.js';

  interface Props {
    onTogglePlay: () => void;
    onSeek: (time: number) => void;
    onTogglePip: () => void;
    onToggleEditMode: () => void;
    onTaskSubmit?: () => void;
    autosave: AutoSaveState;
    taskMode: TaskModeState | null;
    showShortcutsHelp: boolean;
    onToggleShortcutsHelp: () => void;
  }

  let { onTogglePlay, onSeek, onTogglePip, onToggleEditMode, onTaskSubmit, autosave, taskMode = null, showShortcutsHelp, onToggleShortcutsHelp }: Props = $props();

  const timeline = getTimelineState();
  const session = getSessionState();
  const editor = getEditorState();
  const annotations = getAnnotationDataState();

  const hasMeshTopology = $derived(!!annotations.facialTracking?.metadata?.mesh_topology);

  const taskTypeLabels: Record<string, string> = {
    tag_session_bounds: 'Session Bounds',
    verify_states: 'Verify States',
    verify_intents: 'Verify Intents',
    tag_backchannels: 'Backchannels',
  };

  function formatElapsed(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function handleZoomInput(e: Event) {
    const target = e.target as HTMLInputElement;
    timeline.zoom = parseFloat(target.value);
  }
</script>

<header class="h-12 flex items-center gap-4 px-4 border-b border-viewer-border shrink-0 {editor.editing ? 'viewer-header-editing' : 'bg-viewer-surface'}">
  <!-- Back link -->
  <a
    href="/videos/{session.videoId}"
    class="text-viewer-text-dim hover:text-viewer-text text-sm transition-colors flex items-center gap-1"
  >
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
    Back
  </a>

  <div class="w-px h-6 bg-viewer-border"></div>

  <!-- Filename -->
  <span class="text-sm text-viewer-text truncate max-w-48">{session.filename}</span>

  <div class="flex-1"></div>

  <!-- Play/Pause -->
  <button
    onclick={onTogglePlay}
    class="w-8 h-8 flex items-center justify-center rounded hover:bg-viewer-surface-2 text-viewer-text transition-colors"
  >
    {#if timeline.playing}
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
    {:else}
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
    {/if}
  </button>

  <!-- Time display -->
  <span class="text-xs text-viewer-text tabular-nums whitespace-nowrap text-center">
    {formatTimePrecise(timeline.currentTime)} / {formatTimePrecise(timeline.duration)}
  </span>

  <!-- Edit mode controls -->
  <div class="w-px h-6 bg-viewer-border"></div>

  {#if taskMode?.active}
    <!-- Task mode: show task badge instead of edit toggle -->
    <span class="px-2 py-1 rounded text-viewer-sm bg-indigo-500/20 text-indigo-400">
      {taskTypeLabels[taskMode.task?.taskType ?? ''] ?? 'Task'}
    </span>
    <span class="text-viewer-sm tabular-nums text-viewer-text-dim">
      {formatElapsed(taskMode.elapsedSecs)}
    </span>
    <span class="text-viewer-sm text-viewer-text-dim">
      Edits: <span class="tabular-nums text-viewer-text">{taskMode.editCount}</span>
    </span>
  {:else}
    <button
      onclick={onToggleEditMode}
      class="px-2 py-1 rounded text-viewer-sm transition-colors {editor.editing ? 'bg-amber-500/20 text-amber-400' : 'text-viewer-text-dim hover:text-viewer-text'}"
      title="Toggle edit mode ({navigator?.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}+E)"
    >
      {editor.editing ? 'Editing' : 'Edit'}
    </button>
  {/if}

  {#if editor.editing}
    <button
      onclick={() => editor.undo()}
      disabled={!editor.canUndo}
      class="w-8 h-8 flex items-center justify-center rounded transition-colors {editor.canUndo ? 'text-viewer-text hover:bg-viewer-surface-2' : 'text-viewer-text-dim/40 cursor-not-allowed'}"
      title="Undo ({navigator?.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}+Z)"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13"/></svg>
    </button>
    <button
      onclick={() => editor.redo()}
      disabled={!editor.canRedo}
      class="w-8 h-8 flex items-center justify-center rounded transition-colors {editor.canRedo ? 'text-viewer-text hover:bg-viewer-surface-2' : 'text-viewer-text-dim/40 cursor-not-allowed'}"
      title="Redo ({navigator?.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}+Shift+Z)"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.69 3L21 13"/></svg>
    </button>

    <div class="w-px h-6 bg-viewer-border"></div>

    {#if taskMode?.active}
      <button
        onclick={onTaskSubmit}
        disabled={taskMode.submitted}
        class="px-2.5 py-1 rounded text-viewer-sm font-medium transition-colors {taskMode.submitted ? 'bg-green-900/30 text-green-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-500'}"
      >
        {taskMode.submitted ? 'Submitted' : 'Submit for Review'}
      </button>
    {:else if editor.hasChanges && autosave.status !== 'saving'}
      <button
        onclick={() => autosave.saveNow()}
        class="px-2.5 py-1 rounded text-viewer-sm font-medium bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 transition-colors"
        title="Save changes ({navigator?.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}+S)"
      >
        Save
      </button>
    {/if}

    <SaveIndicator {autosave} onForceSave={() => autosave.saveNow()} />
  {/if}

  <div class="flex-1"></div>

  <!-- Normalize toggle -->
  <button
    onclick={() => session.normalized = !session.normalized}
    class="px-2 py-1 rounded text-viewer-sm transition-colors {session.normalized ? 'bg-indigo-500/20 text-indigo-400' : 'text-viewer-text-dim hover:text-viewer-text'}"
    title="Normalize track scales to fit data range (N)"
  >
    Normalize
  </button>

  {#if hasMeshTopology}
    <button
      onclick={() => session.meshOverlayVisible = !session.meshOverlayVisible}
      class="px-2 py-1 rounded text-viewer-sm transition-colors {session.meshOverlayVisible ? 'bg-purple-500/20 text-purple-400' : 'text-viewer-text-dim hover:text-viewer-text'}"
      title="Face mesh overlay (F)"
    >
      <svg class="w-3.5 h-3.5 mr-1 inline-block align-[-2px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="10" r="7" />
        <path d="M5 10 Q12 16 19 10" />
        <path d="M5 10 Q12 4 19 10" />
        <line x1="12" y1="3" x2="12" y2="17" />
      </svg>
      Mesh
    </button>
  {/if}

  <div class="w-px h-6 bg-viewer-border"></div>

  <!-- Zoom control -->
  <div class="flex items-center gap-2">
    <span class="text-viewer-sm text-viewer-text-dim">Zoom</span>
    <input
      type="range"
      min="0.5"
      max="100"
      step="0.1"
      value={timeline.zoom}
      oninput={handleZoomInput}
      class="w-24 h-1 accent-indigo-500"
    />
    <span class="text-viewer-sm tabular-nums text-viewer-text-dim w-10">{timeline.zoom.toFixed(1)}x</span>
  </div>

  <!-- Theme toggle -->
  <ThemeToggle />

  <!-- Keyboard shortcuts help -->
  <button
    onclick={onToggleShortcutsHelp}
    class="w-8 h-8 flex items-center justify-center rounded hover:bg-viewer-surface-2 text-viewer-text-dim hover:text-viewer-text transition-colors"
    title="Keyboard shortcuts (?)"
  >
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M6 12h.01"/><path d="M10 12h.01"/><path d="M14 12h.01"/><path d="M18 12h.01"/><path d="M8 16h8"/></svg>
  </button>

  <!-- PiP toggle -->
  {#if session.pipSupported}
    <div class="w-px h-6 bg-viewer-border"></div>
    <button
      onclick={onTogglePip}
      class="w-8 h-8 flex items-center justify-center rounded hover:bg-viewer-surface-2 text-viewer-text transition-colors"
      title={session.pipActive ? 'Exit Picture-in-Picture (P)' : 'Picture-in-Picture (P)'}
    >
      {#if session.pipActive}
        <!-- PiP exit: small rect returning into large rect -->
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="m19 13-3 0 0-3" />
        </svg>
      {:else}
        <!-- PiP enter: small rect popping out of large rect -->
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <rect x="13" y="9" width="7" height="5" rx="1" fill="currentColor" opacity="0.3" />
        </svg>
      {/if}
    </button>
  {/if}
</header>

{#if showShortcutsHelp}
  <KeyboardShortcutsHelp onClose={onToggleShortcutsHelp} />
{/if}
