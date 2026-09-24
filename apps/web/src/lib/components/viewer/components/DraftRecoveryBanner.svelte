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
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return `${days} d ago`;
  }
</script>

<!-- InfoBox: inset surface, 1px border, 4px amber left border, teal action -->
<div class="dr-banner" role="status">
  <span>
    <span class="dr-lead">Unsaved draft from {timeAgo}.</span>
    <span class="dr-detail">
      {#if isStale}
        The server version is newer. Restoring replaces it.
      {:else}
        Restore it to pick up where you left off.
      {/if}
    </span>
  </span>
  <div class="dr-spacer"></div>
  <button type="button" class="font-mono dr-btn dr-btn-secondary" onclick={onDiscard}>Discard</button>
  <button type="button" class="font-mono dr-btn dr-btn-primary" onclick={onRestore}>
    {isStale ? 'Restore anyway' : 'Restore draft'}
  </button>
</div>

<style>
  .dr-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    padding: 10px 14px;
    background-color: var(--viewer-surface-2);
    color: var(--viewer-text);
    border: 1px solid var(--viewer-border);
    border-left: 4px solid var(--viewer-ornament);
    font-size: 13px;
  }

  .dr-lead {
    font-weight: 500;
  }

  .dr-detail {
    color: var(--viewer-text-dim);
  }

  .dr-spacer {
    flex: 1;
  }

  .dr-btn {
    height: 28px;
    display: inline-flex;
    align-items: center;
    flex: none;
    padding: 0 12px;
    border-radius: 2px;
    border: 1px solid transparent;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background-color 150ms, border-color 150ms, color 150ms;
  }

  .dr-btn-secondary {
    background: transparent;
    border-color: var(--viewer-border);
    color: var(--viewer-text-dim);
  }
  .dr-btn-secondary:hover {
    color: var(--viewer-text);
    border-color: var(--viewer-text-subtle);
  }

  .dr-btn-primary {
    background-color: var(--viewer-accent);
    color: var(--viewer-accent-fg);
  }
  .dr-btn-primary:hover {
    background-color: var(--viewer-accent-hover);
  }

  .dr-btn:focus-visible {
    outline: 2px solid var(--viewer-accent);
    outline-offset: 2px;
  }
</style>
