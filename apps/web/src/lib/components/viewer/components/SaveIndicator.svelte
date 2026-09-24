<script lang="ts">
  import { untrack } from 'svelte';
  import { browser } from '$app/environment';
  import { getEditorState } from '../context.js';
  import type { AutoSaveState } from '../state/autosave.svelte.js';

  interface Props {
    autosave: AutoSaveState;
    /** Retry handler for the failed state. Defaults to autosave.saveNow(). */
    onRetry?: () => void;
    /**
     * Edits since the last successful save. Defaults to an internal count of
     * editor.dirtyVersion bumps since the last save (or since entering edit mode).
     */
    unsavedEdits?: number;
  }

  let { autosave, onRetry, unsavedEdits }: Props = $props();

  const editor = getEditorState();

  const modKey = browser && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

  // dirtyVersion is monotonic: remember where it stood at the last save or
  // edit-mode entry, and count the bumps since.
  let baseline = $state(0);
  $effect(() => {
    void autosave.lastSavedAt;
    void editor.editing;
    baseline = untrack(() => editor.dirtyVersion);
  });
  const editsSinceSave = $derived(unsavedEdits ?? Math.max(0, editor.dirtyVersion - baseline));

  // Coarse clock for the relative "Saved 12 s ago" label.
  let now = $state(Date.now());
  $effect(() => {
    if (autosave.lastSavedAt === null) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 5000);
    return () => clearInterval(id);
  });

  function relative(ts: number, at: number): string {
    const secs = Math.max(0, Math.round((at - ts) / 1000));
    if (secs < 5) return 'just now';
    if (secs < 60) return `${secs} s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const d = new Date(ts);
    return `at ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  type Kind = 'saved' | 'unsaved' | 'saving' | 'failed';
  const kind: Kind = $derived(
    autosave.status === 'saving'
      ? 'saving'
      : autosave.status === 'error'
        ? 'failed'
        : editor.hasChanges
          ? 'unsaved'
          : 'saved',
  );

  const reason = $derived(
    autosave.lastError && autosave.lastError.length <= 32 ? autosave.lastError : 'network',
  );

  function retry() {
    if (onRetry) onRetry();
    else void autosave.saveNow();
  }
</script>

<span class="save-indicator" data-state={kind} role="status" aria-live="polite">
  <span class="save-glyph" aria-hidden="true"></span>
  {#if kind === 'saving'}
    Saving…
  {:else if kind === 'failed'}
    <span class="truncate" title={autosave.lastError ?? undefined}>Save failed · {reason}</span>
    <button type="button" class="save-retry" onclick={retry}>Retry {modKey}S</button>
  {:else if kind === 'unsaved'}
    Unsaved{#if editsSinceSave > 0}&nbsp;· {editsSinceSave} {editsSinceSave === 1 ? 'edit' : 'edits'}{/if}
  {:else}
    Saved{#if autosave.lastSavedAt !== null}&nbsp;{relative(autosave.lastSavedAt, now)}{/if}
  {/if}
</span>

<style>
  .save-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    color: var(--viewer-text-dim);
    transition: color 150ms ease;
  }

  /* Diamond glyph: 6px square rotated 45deg */
  .save-glyph {
    flex: none;
    width: 6px;
    height: 6px;
    box-sizing: border-box;
    transform: rotate(45deg);
    background-color: var(--viewer-text-subtle);
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .save-indicator[data-state='unsaved'] .save-glyph {
    background-color: transparent;
    border: 1px solid var(--viewer-text-dim);
  }

  .save-indicator[data-state='saving'] .save-glyph {
    background-color: var(--viewer-accent);
  }

  .save-indicator[data-state='failed'] {
    color: var(--viewer-danger);
  }

  .save-indicator[data-state='failed'] .save-glyph {
    background-color: var(--viewer-danger);
  }

  .save-retry {
    color: inherit;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  .save-retry:hover {
    text-decoration: none;
  }
</style>
