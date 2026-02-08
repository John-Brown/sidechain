<script lang="ts" generics="T">
  import { getTimelineState } from '../context.js';
  import { binarySearchStart, binarySearchEnd } from '../utils/binary-search.js';

  interface Props {
    data: T[];
    getStart: (item: T) => number;
    getEnd: (item: T) => number;
    blockClass: (item: T) => string;
    blockLabel: (item: T) => string;
    onBlockClick?: (item: T) => void;
    height?: number;
  }

  let { data, getStart, getEnd, blockClass, blockLabel, onBlockClick, height = 48 }: Props = $props();

  const timeline = getTimelineState();

  // Viewport-culled visible blocks with pixel positions
  const visibleBlocks = $derived.by(() => {
    if (!data || data.length === 0) return [];

    // Create a time_range-compatible wrapper for binary search
    const wrapped = data.map((item, i) => ({
      index: i,
      time_range: { start: getStart(item), end: getEnd(item) }
    }));

    const startIdx = binarySearchStart(wrapped, timeline.viewStartTime);
    const endIdx = binarySearchEnd(wrapped, timeline.viewEndTime);

    const result: Array<{ item: T; left: number; width: number; label: string; cssClass: string; index: number }> = [];
    for (let i = startIdx; i <= endIdx && i < data.length; i++) {
      if (i < 0) continue;
      const item = data[i];
      const start = getStart(item);
      const end = getEnd(item);
      const left = timeline.timeToPx(start);
      const width = timeline.timeToPx(end - start);
      result.push({
        item,
        left,
        width: Math.max(width, 2),
        label: blockLabel(item),
        cssClass: blockClass(item),
        index: i,
      });
    }
    return result;
  });
</script>

<div class="relative w-full overflow-hidden" style="height: {height}px">
  {#each visibleBlocks as block (block.index)}
    <button
      class="absolute top-1 bottom-1 rounded-sm border text-[9px] font-mono leading-none overflow-hidden whitespace-nowrap px-1 flex items-center cursor-pointer {block.cssClass}"
      style="transform: translateX({block.left}px); width: {block.width}px; will-change: transform; contain: layout style;"
      onclick={() => onBlockClick?.(block.item)}
    >
      {#if block.width > 20}
        {block.label}
      {/if}
    </button>
  {/each}
</div>
