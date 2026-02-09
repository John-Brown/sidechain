<script lang="ts">
  import type { AutoSaveState } from '../state/autosave.svelte.js';

  interface Props {
    autosave: AutoSaveState;
    onForceSave?: () => void;
  }

  let { autosave, onForceSave }: Props = $props();
</script>

{#if autosave.status === 'saving'}
  <span class="flex items-center gap-1.5 text-viewer-sm text-viewer-text-dim">
    <span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
    Saving...
  </span>
{:else if autosave.status === 'saved'}
  <span class="flex items-center gap-1.5 text-viewer-sm text-green-400">
    <span class="inline-block w-1.5 h-1.5 rounded-full bg-green-400"></span>
    Saved
  </span>
{:else if autosave.status === 'error'}
  <span class="flex items-center gap-1.5 text-viewer-sm text-red-400">
    <span class="inline-block w-1.5 h-1.5 rounded-full bg-red-400"></span>
    {autosave.lastError ?? 'Save failed'}
    {#if onForceSave}
      <button
        onclick={onForceSave}
        class="underline hover:no-underline text-red-400"
      >
        Retry
      </button>
    {/if}
  </span>
{/if}
