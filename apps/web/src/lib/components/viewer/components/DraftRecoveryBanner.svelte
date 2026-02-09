<script lang="ts">
  import type { DraftData } from '../state/autosave.svelte.js';

  interface Props {
    draft: DraftData;
    isStale?: boolean;
    onRestore: () => void;
    onDiscard: () => void;
  }

  let { draft, isStale = false, onRestore, onDiscard }: Props = $props();

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

<div
  class="flex items-center gap-3 px-4 py-2 border-b"
  style="background: var(--viewer-warning-bg); border-color: var(--viewer-warning-border); color: var(--viewer-warning-text);"
>
  <span class="inline-block w-2 h-2 rounded-full shrink-0" style="background: var(--viewer-warning-border);"></span>
  <span class="text-sm">
    {#if isStale}
      Server data is newer — draft may be outdated ({timeAgo})
    {:else}
      Unsaved draft found ({timeAgo})
    {/if}
  </span>
  <div class="flex-1"></div>
  <button
    onclick={onRestore}
    class="px-3 py-1 text-sm rounded transition-colors"
    style="background: var(--viewer-warning-btn-bg); color: var(--viewer-warning-btn-text);"
  >
    {isStale ? 'Restore Anyway' : 'Restore draft'}
  </button>
  <button
    onclick={onDiscard}
    class="px-3 py-1 text-sm rounded text-viewer-text-dim hover:text-viewer-text transition-colors"
  >
    Discard
  </button>
</div>
