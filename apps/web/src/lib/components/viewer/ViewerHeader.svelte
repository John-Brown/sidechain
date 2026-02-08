<script lang="ts">
  import { getTimelineState, getSessionState } from './context.js';
  import { formatTimePrecise } from './utils/format-time.js';

  interface Props {
    onTogglePlay: () => void;
    onSeek: (time: number) => void;
  }

  let { onTogglePlay, onSeek }: Props = $props();

  const timeline = getTimelineState();
  const session = getSessionState();

  function handleZoomInput(e: Event) {
    const target = e.target as HTMLInputElement;
    timeline.zoom = parseFloat(target.value);
  }
</script>

<header class="h-12 flex items-center gap-4 px-4 bg-viewer-surface border-b border-viewer-border shrink-0">
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
  <span class="text-xs font-mono text-viewer-text tabular-nums w-28 text-center">
    {formatTimePrecise(timeline.currentTime)} / {formatTimePrecise(timeline.duration)}
  </span>

  <div class="flex-1"></div>

  <!-- Zoom control -->
  <div class="flex items-center gap-2">
    <span class="text-[10px] text-viewer-text-dim">Zoom</span>
    <input
      type="range"
      min="0.5"
      max="20"
      step="0.1"
      value={timeline.zoom}
      oninput={handleZoomInput}
      class="w-24 h-1 accent-indigo-500"
    />
    <span class="text-[10px] font-mono text-viewer-text-dim w-10">{timeline.zoom.toFixed(1)}x</span>
  </div>
</header>
