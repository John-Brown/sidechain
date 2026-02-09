<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');
  const mod = isMac ? 'Cmd' : 'Ctrl';

  interface Shortcut {
    keys: string;
    description: string;
    editOnly?: boolean;
  }

  interface ShortcutGroup {
    title: string;
    shortcuts: Shortcut[];
  }

  const groups: ShortcutGroup[] = [
    {
      title: 'Playback',
      shortcuts: [
        { keys: 'Space', description: 'Play / pause' },
        { keys: 'Left / Right', description: 'Seek ±1s' },
        { keys: 'Shift + Left / Right', description: 'Seek ±5s' },
        { keys: 'Home / End', description: 'Jump to start / end' },
      ],
    },
    {
      title: 'Navigation',
      shortcuts: [
        { keys: `${mod} + Scroll`, description: 'Zoom timeline' },
        { keys: 'P', description: 'Toggle Picture-in-Picture' },
        { keys: 'N', description: 'Toggle normalize' },
      ],
    },
    {
      title: 'Editing',
      shortcuts: [
        { keys: `${mod} + E`, description: 'Toggle edit mode' },
        { keys: `${mod} + Z`, description: 'Undo', editOnly: true },
        { keys: `${mod} + Shift + Z`, description: 'Redo', editOnly: true },
        { keys: `${mod} + S`, description: 'Force save', editOnly: true },
        { keys: 'Delete / Backspace', description: 'Delete selected', editOnly: true },
        { keys: 'S', description: 'Split at playhead', editOnly: true },
        { keys: 'M', description: 'Merge with adjacent', editOnly: true },
        { keys: 'C', description: 'Classify selected', editOnly: true },
      ],
    },
    {
      title: 'Selection',
      shortcuts: [
        { keys: 'Tab', description: 'Select next annotation', editOnly: true },
        { keys: 'Shift + Tab', description: 'Select previous annotation', editOnly: true },
        { keys: 'Escape', description: 'Deselect / exit edit mode', editOnly: true },
        { keys: '?', description: 'Show this help' },
      ],
    },
  ];

  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeydown, true);
    return () => document.removeEventListener('keydown', handleKeydown, true);
  });

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="shortcuts-backdrop" onclick={handleBackdropClick} role="presentation">
  <div class="shortcuts-dialog" role="dialog" aria-label="Keyboard shortcuts">
    <div class="shortcuts-header">
      <h3 class="shortcuts-title">Keyboard Shortcuts</h3>
      <button class="shortcuts-close" onclick={onClose} aria-label="Close">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>

    <div class="shortcuts-body">
      {#each groups as group}
        <div class="shortcuts-group">
          <h4 class="shortcuts-group-title">{group.title}</h4>
          <div class="shortcuts-list">
            {#each group.shortcuts as shortcut}
              <div class="shortcuts-row">
                <kbd class="shortcuts-keys">{shortcut.keys}</kbd>
                <span class="shortcuts-desc">
                  {shortcut.description}
                  {#if shortcut.editOnly}
                    <span class="shortcuts-edit-badge">Edit</span>
                  {/if}
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .shortcuts-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
  }

  .shortcuts-dialog {
    width: 440px;
    max-height: 80vh;
    overflow-y: auto;
    border-radius: 8px;
    border: 1px solid var(--viewer-border);
    background: var(--viewer-surface);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .shortcuts-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--viewer-border);
    position: sticky;
    top: 0;
    background: var(--viewer-surface);
  }

  .shortcuts-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--viewer-text);
    margin: 0;
  }

  .shortcuts-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--viewer-text-dim);
    cursor: pointer;
  }

  .shortcuts-close:hover {
    background: var(--viewer-surface-2);
    color: var(--viewer-text);
  }

  .shortcuts-body {
    padding: 12px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .shortcuts-group-title {
    font-size: 11px;
    font-weight: 500;
    color: var(--viewer-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 8px;
  }

  .shortcuts-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .shortcuts-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 0;
  }

  .shortcuts-keys {
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    color: var(--viewer-text);
    background: var(--viewer-bg);
    border: 1px solid var(--viewer-border);
    border-radius: 4px;
    padding: 2px 8px;
    white-space: nowrap;
  }

  .shortcuts-desc {
    font-size: 12px;
    color: var(--viewer-text-dim);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .shortcuts-edit-badge {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgb(251 191 36);
    background: rgb(251 191 36 / 0.15);
    padding: 1px 5px;
    border-radius: 3px;
  }
</style>
