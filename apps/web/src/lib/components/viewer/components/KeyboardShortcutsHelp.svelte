<script lang="ts">
  import { onMount } from 'svelte';
  import { createFocusTrap } from '../utils/focus-trap';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let dialogEl: HTMLDivElement;

  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');
  const mod = isMac ? '\u2318' : 'Ctrl';

  interface Shortcut {
    keys: string[];
    description: string;
    editOnly?: boolean;
  }

  interface ShortcutGroup {
    title: string;
    shortcuts: Shortcut[];
  }

  const leftColumn: ShortcutGroup[] = [
    {
      title: 'Playback',
      shortcuts: [
        { keys: ['Space'], description: 'Play / pause' },
        { keys: ['\u2190', '\u2192'], description: 'Seek \u00b11s' },
        { keys: ['\u21e7', '\u2190', '\u2192'], description: 'Seek \u00b15s' },
        { keys: ['Home', 'End'], description: 'Jump to start / end' },
      ],
    },
    {
      title: 'Navigation',
      shortcuts: [
        { keys: [mod, 'Scroll'], description: 'Zoom timeline' },
        { keys: ['P'], description: 'Picture-in-Picture' },
        { keys: ['N'], description: 'Toggle normalize' },
        { keys: ['F'], description: 'Toggle face mesh' },
        { keys: ['?'], description: 'This help' },
      ],
    },
  ];

  const rightColumn: ShortcutGroup[] = [
    {
      title: 'Editing',
      shortcuts: [
        { keys: [mod, 'E'], description: 'Toggle edit mode' },
        { keys: [mod, 'Z'], description: 'Undo', editOnly: true },
        { keys: [mod, '\u21e7', 'Z'], description: 'Redo', editOnly: true },
        { keys: [mod, 'S'], description: 'Force save', editOnly: true },
        { keys: ['\u232b'], description: 'Delete selected', editOnly: true },
        { keys: ['S'], description: 'Split at playhead', editOnly: true },
        { keys: ['M'], description: 'Merge adjacent', editOnly: true },
        { keys: ['C'], description: 'Classify / rename', editOnly: true },
      ],
    },
    {
      title: 'Selection',
      shortcuts: [
        { keys: ['Tab'], description: 'Next annotation', editOnly: true },
        { keys: ['\u21e7', 'Tab'], description: 'Previous annotation', editOnly: true },
        { keys: ['Esc'], description: 'Deselect / exit edit', editOnly: true },
      ],
    },
  ];

  onMount(() => {
    const cleanupTrap = createFocusTrap(dialogEl);

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeydown, true);
    return () => {
      cleanupTrap();
      document.removeEventListener('keydown', handleKeydown, true);
    };
  });

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }
</script>

{#snippet shortcutRow(shortcut: Shortcut)}
  <div class="sk-row">
    <span class="sk-desc">
      {shortcut.description}
      {#if shortcut.editOnly}
        <span class="sk-edit-badge">Edit</span>
      {/if}
    </span>
    <span class="sk-keys">
      {#each shortcut.keys as key, i}
        <kbd class="sk-key">{key}</kbd>
      {/each}
    </span>
  </div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="sk-backdrop" onclick={handleBackdropClick} role="presentation" bind:this={dialogEl}>
  <div class="sk-dialog" role="dialog" aria-label="Keyboard shortcuts" aria-modal="true">
    <div class="sk-header">
      <h3 class="sk-title">Keyboard Shortcuts</h3>
      <button class="sk-close" onclick={onClose} aria-label="Close">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>

    <div class="sk-body">
      <div class="sk-column">
        {#each leftColumn as group}
          <div class="sk-group">
            <h4 class="sk-group-title">{group.title}</h4>
            {#each group.shortcuts as shortcut}
              {@render shortcutRow(shortcut)}
            {/each}
          </div>
        {/each}
      </div>

      <div class="sk-divider"></div>

      <div class="sk-column">
        {#each rightColumn as group}
          <div class="sk-group">
            <h4 class="sk-group-title">{group.title}</h4>
            {#each group.shortcuts as shortcut}
              {@render shortcutRow(shortcut)}
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .sk-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
  }

  .sk-dialog {
    width: 580px;
    max-height: 80vh;
    overflow-y: auto;
    border-radius: 10px;
    border: 1px solid var(--viewer-border);
    background: var(--viewer-surface);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  }

  .sk-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--viewer-border);
    position: sticky;
    top: 0;
    background: var(--viewer-surface);
    z-index: 1;
  }

  .sk-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--viewer-text);
    margin: 0;
  }

  .sk-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--viewer-text-dim);
    cursor: pointer;
  }

  .sk-close:hover {
    background: var(--viewer-surface-2);
    color: var(--viewer-text);
  }

  .sk-body {
    display: flex;
    padding: 16px 20px 20px;
    gap: 0;
  }

  .sk-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .sk-divider {
    width: 1px;
    background: var(--viewer-border);
    margin: 0 16px;
    align-self: stretch;
  }

  .sk-group {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .sk-group-title {
    font-size: 10px;
    font-weight: 600;
    color: var(--viewer-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid color-mix(in srgb, var(--viewer-border) 50%, transparent);
  }

  .sk-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 0;
    gap: 12px;
  }

  .sk-desc {
    font-size: 12px;
    color: var(--viewer-text-dim);
    display: flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }

  .sk-keys {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .sk-key {
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    color: var(--viewer-text);
    background: var(--viewer-bg);
    border: 1px solid var(--viewer-border);
    border-radius: 4px;
    padding: 1px 6px;
    min-width: 20px;
    text-align: center;
    line-height: 18px;
    box-shadow: 0 1px 0 var(--viewer-border);
  }

  .sk-edit-badge {
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
