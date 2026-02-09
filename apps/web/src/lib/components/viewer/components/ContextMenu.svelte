<script lang="ts">
  import { onMount } from 'svelte';

  interface MenuItem {
    label: string;
    shortcut?: string;
    action: () => void;
    disabled?: boolean;
    separator?: false;
  }

  interface MenuSeparator {
    separator: true;
  }

  type MenuEntry = MenuItem | MenuSeparator;

  interface Props {
    x: number;
    y: number;
    items: MenuEntry[];
    onClose: () => void;
  }

  let { x, y, items, onClose }: Props = $props();

  let menuEl: HTMLDivElement;

  // Adjust position to stay within viewport
  let adjustedX = $state(0);
  let adjustedY = $state(0);

  // Initialize from props (avoids state_referenced_locally warning)
  $effect(() => {
    adjustedX = x;
    adjustedY = y;
  });

  onMount(() => {
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    adjustedX = x + rect.width > vw ? vw - rect.width - 4 : x;
    adjustedY = y + rect.height > vh ? vh - rect.height - 4 : y;

    // Close on outside click
    function handleOutsideClick(e: MouseEvent) {
      if (menuEl && !menuEl.contains(e.target as Node)) {
        onClose();
      }
    }

    // Close on Escape
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }

    // Delay to avoid the same click that opened the menu from closing it
    requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handleOutsideClick);
      document.addEventListener('keydown', handleKeydown);
    });

    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeydown);
    };
  });

  function handleItemClick(item: MenuItem) {
    if (item.disabled) return;
    item.action();
    onClose();
  }
</script>

<div
  bind:this={menuEl}
  class="context-menu"
  style="left: {adjustedX}px; top: {adjustedY}px;"
  role="menu"
>
  {#each items as entry}
    {#if entry.separator}
      <div class="context-menu-separator" role="separator"></div>
    {:else}
      <button
        class="context-menu-item"
        class:context-menu-item-disabled={entry.disabled}
        role="menuitem"
        disabled={entry.disabled}
        onclick={() => handleItemClick(entry)}
      >
        <span>{entry.label}</span>
        {#if entry.shortcut}
          <span class="context-menu-shortcut">{entry.shortcut}</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .context-menu {
    position: fixed;
    z-index: 100;
    min-width: 160px;
    padding: 4px;
    border-radius: 6px;
    border: 1px solid var(--viewer-border);
    background: var(--viewer-surface);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 8px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--viewer-text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .context-menu-item:hover:not(:disabled) {
    background: var(--viewer-surface-2);
  }

  .context-menu-item-disabled {
    color: var(--viewer-text-dim);
    opacity: 0.5;
    cursor: not-allowed;
  }

  .context-menu-shortcut {
    color: var(--viewer-text-dim);
    font-size: 11px;
    margin-left: 16px;
  }

  .context-menu-separator {
    height: 1px;
    margin: 4px 0;
    background: var(--viewer-border);
  }
</style>
