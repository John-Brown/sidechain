<script lang="ts">
  import { Dialog } from 'bits-ui';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

  interface Shortcut {
    k: string;
    d: string;
  }

  interface ShortcutGroup {
    name: string;
    items: Shortcut[];
  }

  // Copy and grouping from the design's SHORTCUTS table (design-pass.html).
  const SHORTCUTS: ShortcutGroup[] = [
    {
      name: 'Playback',
      items: [
        { k: 'Space', d: 'Play / pause' },
        { k: '← →', d: '±1 s' },
        { k: '⇧← →', d: '±5 s' },
        { k: 'Home', d: 'Start' },
        { k: 'P', d: 'Picture-in-picture' },
      ],
    },
    {
      name: 'Review',
      items: [
        { k: '⇥', d: 'Next in review' },
        { k: '⇧⇥', d: 'Previous' },
        { k: '↵', d: 'Confirm' },
        { k: 'C', d: 'Reclassify' },
        { k: '1–6', d: 'Pick category' },
      ],
    },
    {
      name: 'Edit',
      items: [
        { k: '⌘E', d: 'Toggle edit' },
        { k: 'S', d: 'Split at playhead' },
        { k: 'M', d: 'Merge next' },
        { k: '⌫', d: 'Delete' },
        { k: '⌘Z', d: 'Undo · ⇧ redo' },
      ],
    },
    {
      name: 'View',
      items: [
        { k: 'N', d: 'Normalize' },
        { k: 'F', d: 'Face mesh' },
        { k: 'V', d: 'Hide video' },
        { k: '⌥↑↓', d: 'Move track' },
        { k: '?', d: 'This panel' },
      ],
    },
  ];

  /** The design writes Mac glyphs; spell the modifiers out elsewhere. */
  function keyLabel(k: string): string {
    if (isMac) return k;
    return k.replace('⌘', 'Ctrl ').replace('⌥', 'Alt ');
  }

  function handleKeydown(e: KeyboardEvent) {
    // Escape belongs to bits-ui's escape layer; keep the rest away from the viewer shortcuts.
    if (e.key === 'Escape') return;
    e.stopPropagation();
    if (e.key === '?') {
      e.preventDefault();
      onClose();
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
    <Dialog.Content onkeydown={handleKeydown} onEscapeKeydown={(e) => e.stopPropagation()}>
      {#snippet child({ props })}
        <div {...props} class="viewer-theme sk-panel">
          <Dialog.Title level={2} class="sr-only">Keyboard shortcuts</Dialog.Title>
          {#each SHORTCUTS as group (group.name)}
            <div class="sk-group">
              <h3 class="font-mono sk-group-title">{group.name}</h3>
              {#each group.items as s (s.k)}
                <div class="sk-row">
                  <kbd class="font-mono sk-key">{keyLabel(s.k)}</kbd>
                  <span>{s.d}</span>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .ov-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background-color: color-mix(in srgb, var(--viewer-bg) 70%, transparent);
  }

  /* Surface, 1px border, 2px amber top stripe, no shadow; 4 columns per the design */
  .sk-panel {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 101;
    width: min(880px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 20px;
    padding: 16px 20px;
    background-color: var(--viewer-surface);
    color: var(--viewer-text);
    border: 1px solid var(--viewer-border);
    border-top: 2px solid var(--viewer-ornament);
    border-radius: 2px;
    outline: none;
  }

  @media (max-width: 720px) {
    .sk-panel {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .sk-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .sk-group-title {
    margin: 0;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--viewer-border);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--viewer-text-dim);
  }

  .sk-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .sk-key {
    min-width: 22px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    padding: 0 5px;
    box-sizing: border-box;
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
    background-color: var(--viewer-surface-2);
    color: var(--viewer-text);
    font-size: 10px;
    white-space: nowrap;
  }
</style>
