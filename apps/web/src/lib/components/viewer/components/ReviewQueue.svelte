<script lang="ts">
  import { tick } from 'svelte';
  import {
    LOW_CONFIDENCE,
    filterReviewQueue,
    type ReviewFilter,
    type ReviewItem,
    type ReviewSelectVia,
  } from '../review.js';

  interface Props {
    /**
     * Rows to show, sorted (buildReviewQueue order). Normally the open queue;
     * may also include items reviewed this session (listed in `reviewedKeys`)
     * so they stay in place, dimmed with a ✓.
     */
    items: readonly ReviewItem[];
    /** Queue key (ReviewItem.key / queueKeyFor) of the selected item */
    selectedKey?: string | null;
    /** Keys of rows already reviewed: dimmed with a ✓, not counted as open */
    reviewedKeys?: ReadonlySet<string>;
    /** Row click (`pointer`) or ↵ / Space on the active row (`keyboard`) */
    onSelect: (item: ReviewItem, via: ReviewSelectVia) => void;
    /** All | Intents | Words */
    filter?: ReviewFilter;
  }

  let {
    items,
    selectedKey = null,
    reviewedKeys,
    onSelect,
    filter = $bindable('all'),
  }: Props = $props();

  const FILTERS: { id: ReviewFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'intents', label: 'Intents' },
    { id: 'words', label: 'Words' },
  ];

  const listId = `review-queue-${Math.random().toString(36).slice(2, 8)}`;

  const visible = $derived(filterReviewQueue(items, filter));
  const openCount = $derived(reviewedKeys ? items.filter((q) => !reviewedKeys.has(q.key)).length : items.length);

  /** Keyboard cursor (↑/↓); follows the selection when it changes from outside. */
  let activeKey = $state<string | null>(null);
  let listEl = $state<HTMLDivElement>();

  $effect(() => {
    if (selectedKey) activeKey = selectedKey;
  });

  const activeIndex = $derived.by(() => {
    const i = activeKey ? visible.findIndex((q) => q.key === activeKey) : -1;
    return i;
  });

  function rowId(i: number): string {
    return `${listId}-${i}`;
  }

  function hueClass(q: ReviewItem): string {
    if (q.kind === 'intent') return `hue-intent-${q.label}`;
    const m = /(\d+)\s*$/.exec(q.speaker ?? '');
    return `hue-spk-${m ? Number(m[1]) % 2 : 0}`;
  }

  /** MM:SS.s with two-digit minutes. */
  function fmtStart(t: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }

  async function moveActive(delta: number) {
    if (visible.length === 0) return;
    const from = activeIndex < 0 ? (delta > 0 ? -1 : visible.length) : activeIndex;
    const next = Math.max(0, Math.min(visible.length - 1, from + delta));
    activeKey = visible[next].key;
    await tick();
    listEl?.querySelector(`#${rowId(next)}`)?.scrollIntoView({ block: 'nearest' });
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        moveActive(1);
        break;
      case 'ArrowUp':
        moveActive(-1);
        break;
      case 'Home':
        moveActive(-visible.length);
        break;
      case 'End':
        moveActive(visible.length);
        break;
      case 'Enter':
      case ' ': {
        const q = activeIndex >= 0 ? visible[activeIndex] : visible[0];
        if (q) {
          activeKey = q.key;
          onSelect(q, 'keyboard');
        }
        break;
      }
      default:
        return;
    }
    // Keep the viewer's global shortcuts (seek, confirm) out of the list.
    e.preventDefault();
    e.stopPropagation();
  }

  function handleRowClick(q: ReviewItem) {
    activeKey = q.key;
    onSelect(q, 'pointer');
  }

  /** Focus without a keyboard cursor: start the cursor at the selection, or the first row */
  function handleFocus() {
    if (activeIndex < 0 && visible.length > 0) {
      activeKey = selectedKey && visible.some((q) => q.key === selectedKey) ? selectedKey : visible[0].key;
    }
  }
</script>

<section class="h-full min-h-0 min-w-0 flex flex-col bg-viewer-surface text-viewer-text" aria-label="Needs review">
  <header class="h-8 flex-none flex items-center gap-2 px-4 border-b border-viewer-border">
    <span class="font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim">Needs review</span>
    <span class="ornament text-viewer-xs" aria-hidden="true">◆</span>
    <span class="font-mono text-viewer-xs text-viewer-text-subtle">{openCount} below {LOW_CONFIDENCE.toFixed(2)}</span>
    <div class="flex-1"></div>
    <div class="flex border border-viewer-border rounded-sm font-mono text-viewer-xs uppercase" role="group" aria-label="Filter">
      {#each FILTERS as f, i (f.id)}
        <button
          type="button"
          class="seg {i > 0 ? 'border-l border-viewer-border' : ''}"
          aria-pressed={filter === f.id}
          onclick={() => (filter = f.id)}
        >
          {f.label}
        </button>
      {/each}
    </div>
  </header>

  <div
    class="grid-row h-6 flex-none border-b border-viewer-border font-mono text-viewer-xs uppercase tracking-label text-viewer-text-subtle"
    aria-hidden="true"
  >
    <span></span><span>Track</span><span>Label</span><span>Start</span><span>Confidence</span>
  </div>

  {#if visible.length === 0}
    <p class="px-4 py-3 text-viewer-base text-viewer-text-dim">
      Nothing below {LOW_CONFIDENCE.toFixed(2)}{filter === 'all' ? '' : ` in ${filter}`}.
    </p>
  {:else}
    <div
      bind:this={listEl}
      class="list flex-1 min-h-0 overflow-y-auto"
      role="listbox"
      tabindex="0"
      aria-label="Low-confidence items"
      aria-activedescendant={activeIndex >= 0 ? rowId(activeIndex) : undefined}
      data-review-queue
      onfocus={handleFocus}
      onkeydown={handleKeydown}
    >
      {#each visible as q, i (q.key)}
        {@const done = reviewedKeys?.has(q.key) ?? false}
        {@const selected = q.key === selectedKey}
        <!-- svelte-ignore a11y_click_events_have_key_events (keyboard handled on the listbox) -->
        <div
          id={rowId(i)}
          class="grid-row row h-[30px] border-b border-viewer-border text-viewer-base {done ? 'text-viewer-text-subtle' : 'text-viewer-text'}"
          role="option"
          tabindex="-1"
          aria-selected={selected}
          data-active={i === activeIndex ? '' : undefined}
          onclick={() => handleRowClick(q)}
        >
          <span class="w-3 h-3 flex items-center justify-center text-viewer-accent" aria-label={done ? 'Reviewed' : undefined}>{done ? '✓' : ''}</span>
          <span class="text-viewer-text-dim">{q.kind === 'intent' ? 'Intent' : 'Word'}</span>
          <span class="flex items-center gap-2 min-w-0">
            <span class="sw blk {hueClass(q)}" data-lowconf={done ? undefined : ''} data-source={done ? 'human' : 'ai'} aria-hidden="true"></span>
            <span class="truncate">{q.kind === 'word' ? `“${q.label}”` : q.label}</span>
          </span>
          <span class="font-mono text-viewer-sm text-viewer-text-dim">{fmtStart(q.start)}</span>
          <span class="flex items-center gap-2 {hueClass(q)}">
            <span class="bar" aria-hidden="true"><span style:width="{Math.round(q.confidence * 100)}%"></span></span>
            <span class="font-mono text-viewer-sm">{q.confidence.toFixed(2)}</span>
          </span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .ornament {
    color: var(--viewer-ornament);
  }

  .grid-row {
    display: grid;
    grid-template-columns: 28px 96px 1fr 88px 120px;
    align-items: center;
    padding: 0 16px;
  }

  .row {
    cursor: pointer;
    transition: background-color 150ms;
  }

  .row:hover {
    background: var(--viewer-accent-bg);
  }

  .row[aria-selected='true'] {
    background: var(--viewer-accent-bg);
    outline: 2px solid var(--viewer-accent);
    outline-offset: -2px;
  }

  /* Keyboard cursor: only visible while the list has focus. The active row
     carries the ring; the list itself only when no row is active. */
  .list:focus-visible {
    outline-offset: -2px;
  }

  .list:focus-visible:has(.row[data-active]) {
    outline: none;
  }

  .list:focus-visible .row[data-active] {
    outline: 2px solid var(--viewer-accent);
    outline-offset: -2px;
  }

  .list:focus-visible .row[data-active]:not([aria-selected='true']) {
    outline-style: dashed;
  }

  .seg {
    padding: 3px 8px;
    color: var(--viewer-text-dim);
    letter-spacing: 0.08em;
    transition: background-color 150ms, color 150ms;
  }

  .seg:hover {
    color: var(--viewer-text);
  }

  .seg[aria-pressed='true'] {
    background: var(--viewer-surface-2);
    color: var(--viewer-text);
  }

  .sw {
    width: 8px;
    height: 8px;
    flex: none;
  }

  .bar {
    position: relative;
    display: inline-block;
    width: 60px;
    height: 4px;
    background: var(--viewer-surface-2);
  }

  .bar > span {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--h);
  }
</style>
