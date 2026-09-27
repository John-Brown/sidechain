<script lang="ts">
  import { Dialog } from 'bits-ui';

  interface Props {
    currentText: string;
    onConfirm: (text: string) => void;
    onClose: () => void;
  }

  let { currentText, onConfirm, onClose }: Props = $props();

  let text = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    text = currentText;
  });

  const canApply = $derived(text.trim().length > 0);

  function handleConfirm() {
    const trimmed = text.trim();
    if (trimmed) {
      onConfirm(trimmed);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Escape belongs to bits-ui's escape layer; keep the rest away from the viewer shortcuts.
    if (e.key === 'Escape') return;
    e.stopPropagation();
    if (e.key === 'Enter' && e.target === inputEl) {
      e.preventDefault();
      handleConfirm();
    }
  }
</script>

<Dialog.Root open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
  <Dialog.Portal>
    <Dialog.Overlay>
      {#snippet child({ props })}
        <div {...props} class="viewer-theme ov-overlay"></div>
      {/snippet}
    </Dialog.Overlay>
    <Dialog.Content
      onkeydown={handleKeydown}
      onEscapeKeydown={(e) => e.stopPropagation()}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        inputEl?.focus();
        inputEl?.select();
      }}
    >
      {#snippet child({ props })}
        <div {...props} class="viewer-theme ov-dialog">
          <div class="ov-head">
            <Dialog.Title level={2} class="font-serif ov-title">Edit label</Dialog.Title>
          </div>

          <div class="lt-body">
            <input
              bind:this={inputEl}
              bind:value={text}
              type="text"
              class="lt-input"
              placeholder="Label text"
              aria-label="Label text"
            />
          </div>

          <div class="ov-foot">
            <button type="button" class="font-mono ov-btn ov-btn-secondary" onclick={onClose}>
              Cancel <span class="ov-kbd">esc</span>
            </button>
            <button
              type="button"
              class="font-mono ov-btn ov-btn-primary"
              onclick={handleConfirm}
              disabled={!canApply}
            >
              Apply <span class="ov-kbd">↵</span>
            </button>
          </div>
        </div>
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* Shared overlay recipe: surface, 1px border, 2px amber top stripe, 2px radius, no shadow */
  .ov-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background-color: color-mix(in srgb, var(--viewer-bg) 70%, transparent);
  }

  .ov-dialog {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 101;
    width: min(360px, calc(100vw - 32px));
    background-color: var(--viewer-surface);
    color: var(--viewer-text);
    border: 1px solid var(--viewer-border);
    border-top: 2px solid var(--viewer-ornament);
    border-radius: 2px;
    outline: none;
  }

  .ov-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--viewer-border);
  }

  .ov-dialog :global(.ov-title) {
    margin: 0;
    font-size: 20px;
    font-weight: 400;
    line-height: 1.2;
  }

  .ov-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--viewer-border);
  }

  .ov-btn {
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    border-radius: 2px;
    border: 1px solid transparent;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background-color 150ms, border-color 150ms, color 150ms;
  }

  .ov-btn-secondary {
    background: transparent;
    border-color: var(--viewer-border);
    color: var(--viewer-text-dim);
  }
  .ov-btn-secondary:hover {
    color: var(--viewer-text);
    border-color: var(--viewer-text-subtle);
  }
  .ov-btn-secondary .ov-kbd {
    color: var(--viewer-text-subtle);
  }

  .ov-btn-primary {
    background-color: var(--viewer-accent);
    color: var(--viewer-accent-fg);
  }
  .ov-btn-primary:hover:not(:disabled) {
    background-color: var(--viewer-accent-hover);
  }
  .ov-btn-primary .ov-kbd {
    opacity: 0.75;
  }
  .ov-btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ov-btn:focus-visible {
    outline: 2px solid var(--viewer-accent);
    outline-offset: 2px;
  }

  .lt-body {
    padding: 14px 16px;
  }

  .lt-input {
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border-radius: 2px;
    border: 1px solid var(--viewer-border);
    background-color: var(--viewer-bg);
    color: var(--viewer-text);
    font: inherit;
    font-size: 13px;
    outline: none;
    transition: border-color 150ms;
  }

  .lt-input:focus {
    border-color: var(--viewer-accent);
  }

  .lt-input:focus-visible {
    outline: 2px solid var(--viewer-accent);
    outline-offset: 1px;
  }

  .lt-input::placeholder {
    color: var(--viewer-text-subtle);
  }
</style>
