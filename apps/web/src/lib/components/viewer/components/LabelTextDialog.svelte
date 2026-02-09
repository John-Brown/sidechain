<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    currentText: string;
    onConfirm: (text: string) => void;
    onClose: () => void;
  }

  let { currentText, onConfirm, onClose }: Props = $props();

  let text = $state('');
  let inputEl: HTMLInputElement;

  $effect(() => {
    text = currentText;
  });

  onMount(() => {
    inputEl?.focus();
    inputEl?.select();

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

  function handleConfirm() {
    const trimmed = text.trim();
    if (trimmed) {
      onConfirm(trimmed);
    }
  }

  function handleInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="lt-backdrop" onclick={handleBackdropClick} role="presentation">
  <div class="lt-dialog" role="dialog" aria-label="Edit label text">
    <div class="lt-header">
      <h3 class="lt-title">Edit Label</h3>
      <button class="lt-close" onclick={onClose} aria-label="Close">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>

    <div class="lt-body">
      <input
        bind:this={inputEl}
        bind:value={text}
        type="text"
        class="lt-input"
        placeholder="Enter label text..."
        onkeydown={handleInputKeydown}
      />
    </div>

    <div class="lt-footer">
      <button class="lt-btn lt-btn-cancel" onclick={onClose}>Cancel</button>
      <button class="lt-btn lt-btn-confirm" onclick={handleConfirm} disabled={!text.trim()}>Apply</button>
    </div>
  </div>
</div>

<style>
  .lt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
  }

  .lt-dialog {
    width: 340px;
    border-radius: 10px;
    border: 1px solid var(--viewer-border);
    background: var(--viewer-surface);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  }

  .lt-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--viewer-border);
  }

  .lt-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--viewer-text);
    margin: 0;
  }

  .lt-close {
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

  .lt-close:hover {
    background: var(--viewer-surface-2);
    color: var(--viewer-text);
  }

  .lt-body {
    padding: 18px;
  }

  .lt-input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid var(--viewer-border);
    background: var(--viewer-bg);
    color: var(--viewer-text);
    font-size: 14px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .lt-input:focus {
    border-color: var(--viewer-accent);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
  }

  .lt-input::placeholder {
    color: var(--viewer-text-dim);
  }

  .lt-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 18px;
    border-top: 1px solid var(--viewer-border);
  }

  .lt-btn {
    padding: 7px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s, opacity 0.15s;
  }

  .lt-btn-cancel {
    background: var(--viewer-surface-2);
    color: var(--viewer-text-dim);
    border-color: var(--viewer-border);
  }

  .lt-btn-cancel:hover {
    background: var(--viewer-border);
    color: var(--viewer-text);
  }

  .lt-btn-confirm {
    background: var(--viewer-accent);
    color: white;
  }

  .lt-btn-confirm:hover {
    opacity: 0.9;
  }

  .lt-btn-confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
