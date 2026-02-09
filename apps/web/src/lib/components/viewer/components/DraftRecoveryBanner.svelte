<script lang="ts">
  import type { DraftData } from '../state/autosave.svelte.js';

  interface Props {
    draft: DraftData;
    onRestore: () => void;
    onDiscard: () => void;
  }

  let { draft, onRestore, onDiscard }: Props = $props();

  const timeAgo = $derived(getTimeAgo(new Date(draft.savedAt)));

  function getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
</script>

<div class="flex items-center gap-3 px-4 py-2 bg-amber-900/20 border-b border-amber-700/30">
  <span class="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0"></span>
  <span class="text-sm text-amber-200">
    Unsaved draft found ({timeAgo})
  </span>
  <div class="flex-1"></div>
  <button
    onclick={onRestore}
    class="px-3 py-1 text-sm rounded bg-amber-600/30 text-amber-200 hover:bg-amber-600/50 transition-colors"
  >
    Restore draft
  </button>
  <button
    onclick={onDiscard}
    class="px-3 py-1 text-sm rounded text-viewer-text-dim hover:text-viewer-text transition-colors"
  >
    Discard
  </button>
</div>
