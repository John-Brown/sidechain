<script module lang="ts">
  import type { EditType } from '@annotation/shared';

  export interface MenuItem {
    label: string;
    /** Key hint shown on the right; single keys and ⌫ also trigger the item while the menu is open */
    shortcut?: string;
    action: () => void;
    disabled?: boolean;
    /** Render in the danger color (Delete) */
    destructive?: boolean;
    separator?: false;
  }

  export interface MenuSeparator {
    separator: true;
  }

  export type MenuEntry = MenuItem | MenuSeparator;

  export type BlockMenuAction = 'confirm' | 'reclassify' | 'split' | 'merge' | 'jump' | 'delete';

  export interface BlockMenuOptions {
    /** Handlers. An action without a handler renders disabled. */
    actions: Partial<Record<BlockMenuAction, () => void>>;
    /** Task constraint check, e.g. (op) => taskMode.isOperationAllowed(op). Default: everything allowed. */
    isAllowed?: (op: EditType) => boolean;
    /** The block sits in a locked range: every edit is disabled (Jump to start stays). */
    locked?: boolean;
    /** Actions that don't apply here (no next block to merge, playhead outside the block, ...). */
    unavailable?: readonly BlockMenuAction[];
  }

  const BLOCK_MENU: { id: BlockMenuAction; label: string; shortcut: string; op: EditType | null }[] = [
    { id: 'confirm', label: 'Confirm prediction', shortcut: '↵', op: 'confirm' },
    { id: 'reclassify', label: 'Reclassify…', shortcut: 'C', op: 'classify' },
    { id: 'split', label: 'Split at playhead', shortcut: 'S', op: 'split' },
    { id: 'merge', label: 'Merge with next', shortcut: 'M', op: 'merge' },
    { id: 'jump', label: 'Jump to start', shortcut: '[', op: null },
  ];

  /**
   * The block context menu from the design: Confirm ↵, Reclassify… C, Split S,
   * Merge M, Jump to start [, a separator, then Delete ⌫ (destructive).
   * Items are disabled per the allowed operations.
   */
  export function blockMenuItems({ actions, isAllowed = () => true, locked = false, unavailable = [] }: BlockMenuOptions): MenuEntry[] {
    const item = (id: BlockMenuAction, label: string, shortcut: string, op: EditType | null, destructive = false): MenuItem => {
      const action = actions[id];
      const blocked = op !== null && (locked || !isAllowed(op));
      return {
        label,
        shortcut,
        destructive,
        disabled: !action || blocked || unavailable.includes(id),
        action: action ?? (() => {}),
      };
    };
    return [
      ...BLOCK_MENU.map((m) => item(m.id, m.label, m.shortcut, m.op)),
      { separator: true },
      item('delete', 'Delete', '⌫', 'delete', true),
    ];
  }

  /** Does this keydown match an item's shortcut hint? ↵ is left to the menu (it activates the highlighted item). */
  function matchesShortcut(shortcut: string | undefined, e: KeyboardEvent): boolean {
    if (!shortcut || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (shortcut === '⌫') return e.key === 'Backspace' || e.key === 'Delete';
    if (shortcut.length !== 1 || shortcut === '↵') return false;
    return e.key.toLowerCase() === shortcut.toLowerCase();
  }
</script>

<script lang="ts">
  import { DropdownMenu } from 'bits-ui';

  interface Props {
    /** Viewport coordinates (clientX/clientY, or a block's rect for keyboard opening) */
    x: number;
    y: number;
    items: MenuEntry[];
    onClose: () => void;
    /** Accessible name for the menu */
    label?: string;
  }

  let { x, y, items, onClose, label = 'Annotation actions' }: Props = $props();

  // A zero-size virtual anchor at (x, y); floating-ui flips/shifts at the viewport edges.
  const anchor = $derived({
    getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
  });

  function run(item: MenuItem) {
    if (item.disabled) return;
    item.action();
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    // Escape belongs to bits-ui's escape layer on document; keep the rest away
    // from the viewer's window shortcuts (arrows would seek, etc).
    if (e.key === 'Escape') return;
    e.stopPropagation();
    for (const entry of items) {
      if (entry.separator) continue;
      if (matchesShortcut(entry.shortcut, e)) {
        e.preventDefault();
        run(entry);
        return;
      }
    }
  }
</script>

<DropdownMenu.Root open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      customAnchor={anchor}
      side="bottom"
      align="start"
      sideOffset={2}
      collisionPadding={8}
      aria-label={label}
      onkeydown={handleKeydown}
      onEscapeKeydown={(e) => e.stopPropagation()}
    >
      {#snippet child({ props, wrapperProps })}
        <div {...wrapperProps}>
          <div {...props} class="viewer-theme cm-menu">
            {#each items as entry, i (i)}
              {#if entry.separator}
                <DropdownMenu.Separator>
                  {#snippet child({ props: sepProps })}
                    <div {...sepProps} class="cm-sep"></div>
                  {/snippet}
                </DropdownMenu.Separator>
              {:else}
                <DropdownMenu.Item
                  disabled={entry.disabled}
                  textValue={entry.label}
                  onSelect={() => run(entry)}
                >
                  {#snippet child({ props: itemProps })}
                    <div {...itemProps} class="cm-item" class:cm-item-danger={entry.destructive}>
                      <span>{entry.label}</span>
                      {#if entry.shortcut}
                        <span class="font-mono cm-key">{entry.shortcut}</span>
                      {/if}
                    </div>
                  {/snippet}
                </DropdownMenu.Item>
              {/if}
            {/each}
          </div>
        </div>
      {/snippet}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
  /* Surface, 1px border, 2px amber top stripe, 2px radius, no shadow */
  .cm-menu {
    z-index: 100;
    width: 232px;
    padding: 4px 0;
    background-color: var(--viewer-surface);
    color: var(--viewer-text);
    border: 1px solid var(--viewer-border);
    border-top: 2px solid var(--viewer-ornament);
    border-radius: 2px;
    font-size: 12px;
    outline: none;
  }

  .cm-item {
    height: 28px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    color: var(--viewer-text);
    cursor: pointer;
    outline: none;
    user-select: none;
    transition: background-color 150ms;
  }

  .cm-item[data-highlighted] {
    background-color: var(--viewer-accent-bg);
  }

  .cm-item-danger {
    color: var(--viewer-danger);
  }

  .cm-item[data-disabled] {
    color: var(--viewer-text-subtle);
    cursor: not-allowed;
  }

  .cm-key {
    margin-left: auto;
    font-size: 10px;
    color: var(--viewer-text-subtle);
  }

  .cm-sep {
    height: 1px;
    margin: 4px 0;
    background-color: var(--viewer-border);
  }
</style>
