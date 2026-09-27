<script lang="ts" generics="T">
  import { tick } from 'svelte';
  import { getTimelineState } from '../context.js';
  import { binarySearchStart, binarySearchEnd } from '../utils/binary-search.js';
  import type { Provenance } from '../review.js';

  /**
   * Read-only block track (view mode). Blocks use the shared recipe in
   * viewer.css: `blk hue-*` plus data-source / data-lowconf / aria-selected /
   * data-locked attributes, so there are no per-block effects or classes.
   *
   * Keyboard: roving tabindex. One block per track is tabbable; ←/→ move
   * between blocks, ↵ selects. Other keys bubble to the viewer shortcuts.
   */
  interface Props {
    data: T[];
    getStart: (item: T) => number;
    getEnd: (item: T) => number;
    /** Hue class for the block, e.g. "hue-spk-0" or "hue-intent-inform" */
    blockClass: (item: T) => string;
    blockLabel: (item: T) => string;
    /** `data-source`. Defaults to "ai". Pass review.ts `getProvenance` for annotation items. */
    getSource?: (item: T) => Provenance;
    /** `data-lowconf`. Pass review.ts `isLowConfidence` for annotation items. */
    isLowConfidence?: (item: T) => boolean;
    /** Confidence shown on wide low-confidence blocks (".48"). Pass review.ts `getConfidence`. */
    getConfidence?: (item: T) => number | null;
    /** `aria-selected` */
    isSelected?: (item: T, index: number) => boolean;
    /** `data-locked` (task-mode locked ranges) */
    isLocked?: (item: T) => boolean;
    onBlockClick?: (item: T, index: number) => void;
    /** Called when keyboard navigation targets a culled block: scroll so `time` is visible. */
    onReveal?: (time: number) => void;
    /** Accessible name of the track (listbox) */
    label?: string;
    height?: number;
    /** Block top/bottom inset in px */
    inset?: number;
    /** Horizontal text padding in px */
    padX?: number;
    /** Minimum block width (px) before its text is shown */
    minLabelWidth?: number;
  }

  let {
    data,
    getStart,
    getEnd,
    blockClass,
    blockLabel,
    getSource,
    isLowConfidence,
    getConfidence,
    isSelected,
    isLocked,
    onBlockClick,
    onReveal,
    label,
    height = 48,
    inset = 5,
    padX = 5,
    minLabelWidth = 14,
  }: Props = $props();

  /** Gap between adjacent blocks (px), so contiguous borders don't merge */
  const BLOCK_GAP = 1.5;
  /** Minimum block width (px) before the low-confidence value is shown */
  const CONF_MIN_WIDTH = 64;

  const timeline = getTimelineState();

  let containerEl: HTMLDivElement;
  /** Data index of the roving-tabindex block (last focused or clicked) */
  let focusIndex = $state(-1);

  // Viewport-culled visible blocks with pixel positions
  const visibleBlocks = $derived.by(() => {
    if (!data || data.length === 0) return [];

    const startIdx = binarySearchStart(data, timeline.viewStartTime, getEnd);
    const endIdx = binarySearchEnd(data, timeline.viewEndTime, getStart);

    const result: Array<{
      item: T;
      left: number;
      width: number;
      label: string;
      hueClass: string;
      source: Provenance;
      lowconf: boolean;
      conf: string;
      locked: boolean;
      index: number;
    }> = [];
    for (let i = startIdx; i <= endIdx && i < data.length; i++) {
      if (i < 0) continue;
      const item = data[i];
      const start = getStart(item);
      const end = getEnd(item);
      const width = Math.max(timeline.timeToPx(end - start) - BLOCK_GAP, 2);
      const lowconf = isLowConfidence?.(item) ?? false;
      const c = lowconf && width > CONF_MIN_WIDTH ? getConfidence?.(item) : null;
      result.push({
        item,
        left: timeline.timeToPx(start),
        width,
        label: blockLabel(item),
        hueClass: blockClass(item),
        source: getSource?.(item) ?? 'ai',
        lowconf,
        conf: c != null ? c.toFixed(2).slice(1) : '',
        locked: isLocked?.(item) ?? false,
        index: i,
      });
    }
    return result;
  });

  /** The one block with tabindex=0: the focus index if rendered, else the first visible block */
  const tabbableIndex = $derived.by(() => {
    const n = visibleBlocks.length;
    if (n === 0) return -1;
    const first = visibleBlocks[0].index;
    const last = visibleBlocks[n - 1].index;
    return focusIndex >= first && focusIndex <= last ? focusIndex : first;
  });

  function blockEl(index: number): HTMLElement | null {
    return containerEl?.querySelector<HTMLElement>(`[data-block-index="${index}"]`) ?? null;
  }

  /** Focus a block by data index, asking the parent to scroll it into the rendered range if culled */
  async function focusBlock(index: number) {
    focusIndex = index;
    await tick();
    let el = blockEl(index);
    if (!el) {
      onReveal?.(getStart(data[index]));
      // Scroll → timeline.scrollLeft → re-cull takes a frame or two
      for (let attempt = 0; attempt < 3 && !el; attempt++) {
        await new Promise((r) => requestAnimationFrame(r));
        el = blockEl(index);
      }
    }
    el?.focus();
  }

  function activate(item: T, index: number, el: HTMLElement | null) {
    focusIndex = index;
    el?.focus({ preventScroll: true });
    onBlockClick?.(item, index);
  }

  function handleKeydown(e: KeyboardEvent, item: T, index: number) {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const next = index + (e.key === 'ArrowLeft' ? -1 : 1);
      e.preventDefault();
      e.stopPropagation();
      if (next >= 0 && next < data.length) focusBlock(next);
    } else if (e.key === 'Enter') {
      // Already selected: let ↵ bubble to the viewer (confirm)
      if (isSelected?.(item, index)) return;
      e.preventDefault();
      e.stopPropagation();
      activate(item, index, e.currentTarget as HTMLElement);
    }
  }
</script>

<div
  bind:this={containerEl}
  class="relative w-full overflow-hidden"
  style="height: {height}px; contain: layout style;"
  role="listbox"
  aria-label={label}
  aria-orientation="horizontal"
>
  {#each visibleBlocks as block (block.index)}
    <div
      data-block-index={block.index}
      class="blk {block.hueClass} dom-block absolute flex items-center overflow-hidden text-viewer-sm leading-none whitespace-nowrap select-none"
      style="transform: translateX({block.left}px); width: {block.width}px; top: {inset}px; bottom: {inset}px; padding: 0 {padX}px;"
      role="option"
      aria-selected={isSelected?.(block.item, block.index) ?? false}
      tabindex={block.index === tabbableIndex ? 0 : -1}
      data-source={block.source}
      data-lowconf={block.lowconf ? '' : undefined}
      data-locked={block.locked ? '' : undefined}
      onclick={(e) => activate(block.item, block.index, e.currentTarget)}
      onkeydown={(e) => handleKeydown(e, block.item, block.index)}
    >
      {#if block.width > minLabelWidth}
        <span class="blk-text">{block.label}</span>
        {#if block.conf}
          <span class="ml-auto pl-1 font-mono text-viewer-xs">{block.conf}</span>
        {/if}
      {/if}
    </div>
  {/each}
</div>

<style>
  .dom-block {
    cursor: pointer;
    will-change: transform;
    contain: layout style;
  }

  .blk-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: clip;
  }
</style>
