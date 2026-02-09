<script lang="ts" generics="T extends { time_range: { start: number; end: number } }">
  import { getTimelineState, getEditorState } from '../context.js';
  import { binarySearchStart, binarySearchEnd } from '../utils/binary-search.js';
  import type { EditableType } from '../state/editor.svelte.js';
  import {
    type DragState,
    type DragEdge,
    computeDragPreview,
    computeFinalRange,
    validateResize,
  } from '../editing/drag-resize.js';

  interface Props {
    data: T[];
    editableType: EditableType;
    getStart: (item: T) => number;
    getEnd: (item: T) => number;
    blockClass: (item: T) => string;
    blockLabel: (item: T) => string;
    onBlockClick?: (item: T, index: number) => void;
    onBlockDoubleClick?: (item: T, index: number) => void;
    onBlockContextMenu?: (e: MouseEvent, item: T, index: number) => void;
    height?: number;
  }

  let {
    data,
    editableType,
    getStart,
    getEnd,
    blockClass,
    blockLabel,
    onBlockClick,
    onBlockDoubleClick,
    onBlockContextMenu,
    height = 48,
  }: Props = $props();

  const timeline = getTimelineState();
  const editor = getEditorState();

  // --- Drag state (non-reactive, managed imperatively during drag) ---
  let dragState: DragState | null = null;
  let rafId = 0;
  let dragEl: HTMLElement | null = null;

  // Selection reads from shared editor state
  const isSelectedTrack = $derived(editor.selectedType === editableType);

  // Viewport-culled visible blocks with pixel positions
  const visibleBlocks = $derived.by(() => {
    if (!data || data.length === 0) return [];

    const wrapped = data.map((item, i) => ({
      index: i,
      time_range: { start: getStart(item), end: getEnd(item) },
    }));

    const startIdx = binarySearchStart(wrapped, timeline.viewStartTime);
    const endIdx = binarySearchEnd(wrapped, timeline.viewEndTime);

    const result: Array<{
      item: T;
      left: number;
      width: number;
      label: string;
      cssClass: string;
      index: number;
    }> = [];
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

  // --- Drag handlers ---
  function handleHandlePointerDown(
    e: PointerEvent,
    edge: DragEdge,
    index: number,
    item: T,
  ) {
    e.preventDefault();
    e.stopPropagation();

    const el = (e.currentTarget as HTMLElement).closest('[data-block-index]') as HTMLElement;
    if (!el) return;

    el.setPointerCapture(e.pointerId);
    dragEl = el;

    const start = getStart(item);
    const end = getEnd(item);

    dragState = {
      edge,
      index,
      startX: e.clientX,
      originalRange: { start, end },
      originalLeftPx: timeline.timeToPx(start),
      originalWidthPx: timeline.timeToPx(end - start),
    };
  }

  function handleBlockPointerMove(e: PointerEvent) {
    if (!dragState || !dragEl) return;

    cancelAnimationFrame(rafId);
    const clientX = e.clientX;
    const el = dragEl;
    const drag = dragState;
    const zoom = timeline.zoom;

    rafId = requestAnimationFrame(() => {
      const preview = computeDragPreview(drag, clientX, zoom);
      // Direct DOM mutation — no Svelte reactivity
      el.style.transform = `translateX(${preview.translateX}px)`;
      el.style.width = `${preview.width}px`;
    });
  }

  function handleBlockPointerUp(e: PointerEvent) {
    if (!dragState || !dragEl) return;

    cancelAnimationFrame(rafId);
    const el = dragEl;

    const newRange = computeFinalRange(
      dragState,
      e.clientX,
      timeline.zoom,
      timeline.duration,
    );

    // Build time_range-compatible array for overlap checking
    const items = data.map((item) => ({
      time_range: { start: getStart(item), end: getEnd(item) },
    }));

    const valid = validateResize(
      newRange,
      dragState.index,
      items,
      timeline.duration,
    );

    if (valid) {
      // Push undo snapshot before committing
      const history = historyForType() as { push(snapshot: unknown): void } | undefined;
      const currentArray = editor[editableType];
      if (history && currentArray) {
        history.push(structuredClone(currentArray));
      }

      // Commit: update the item's time_range in the editor's data
      const item = data[dragState.index];
      item.time_range.start = newRange.start;
      item.time_range.end = newRange.end;

      // Trigger reactivity by reassigning the array
      // Cast through unknown because generic T can't narrow to the specific annotation type
      (editor as unknown as Record<string, unknown>)[editableType] = [...data];
      editor.lastEditedType = editableType;
      editor.markDirty(editableType);
    } else {
      // Snap back: restore original inline styles
      el.style.transform = `translateX(${dragState.originalLeftPx}px)`;
      el.style.width = `${dragState.originalWidthPx}px`;
    }

    el.releasePointerCapture(e.pointerId);
    dragState = null;
    dragEl = null;
  }

  function handleBlockClick(e: MouseEvent, item: T, index: number) {
    // Don't fire click after a drag
    if (dragState) return;
    editor.select(editableType, index);
    onBlockClick?.(item, index);
  }

  function handleBlockDblClick(e: MouseEvent, item: T, index: number) {
    onBlockDoubleClick?.(item, index);
  }

  function handleBlockContextMenu(e: MouseEvent, item: T, index: number) {
    e.preventDefault();
    editor.select(editableType, index);
    onBlockContextMenu?.(e, item, index);
  }

  function historyForType() {
    switch (editableType) {
      case 'states':
        return editor.stateHistory;
      case 'intents':
        return editor.intentHistory;
      case 'transcription':
        return editor.transcriptionHistory;
      case 'backchannels':
        return editor.backchannelHistory;
    }
  }
</script>

<div class="relative w-full overflow-hidden" style="height: {height}px; contain: layout style;">
  {#each visibleBlocks as block (block.index)}
    {@const isSelected = isSelectedTrack && editor.selectedIndex === block.index}
    <div
      data-block-index={block.index}
      class="editable-block absolute top-1 bottom-1 rounded-sm border text-viewer-xs leading-none overflow-hidden whitespace-nowrap flex items-center {block.cssClass}"
      class:editable-block-selected={isSelected}
      style="transform: translateX({block.left}px); width: {block.width}px; will-change: transform;"
      role="button"
      tabindex="0"
      onclick={(e) => handleBlockClick(e, block.item, block.index)}
      ondblclick={(e) => handleBlockDblClick(e, block.item, block.index)}
      oncontextmenu={(e) => handleBlockContextMenu(e, block.item, block.index)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBlockClick(e as unknown as MouseEvent, block.item, block.index); }}}
      onpointermove={handleBlockPointerMove}
      onpointerup={handleBlockPointerUp}
    >
      <!-- Left resize handle -->
      <div
        role="separator"
        aria-label="Resize start"
        class="editable-handle editable-handle-left"
        onpointerdown={(e) => handleHandlePointerDown(e, 'left', block.index, block.item)}
      ></div>

      <!-- Block body (label) -->
      <span class="flex-1 px-1 pointer-events-none select-none">
        {#if block.width > 20}
          {block.label}
        {/if}
      </span>

      <!-- Right resize handle -->
      <div
        role="separator"
        aria-label="Resize end"
        class="editable-handle editable-handle-right"
        onpointerdown={(e) => handleHandlePointerDown(e, 'right', block.index, block.item)}
      ></div>
    </div>
  {/each}
</div>

<style>
  .editable-block {
    contain: layout style;
    cursor: pointer;
    transition: box-shadow 0.1s;
  }

  .editable-block-selected {
    box-shadow: 0 0 0 2px var(--viewer-accent);
    z-index: 10;
  }

  .editable-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 5;
    /* Invisible but clickable */
    background: transparent;
  }

  .editable-handle:hover {
    background: rgba(99, 102, 241, 0.2);
  }

  .editable-handle-left {
    left: 0;
  }

  .editable-handle-right {
    right: 0;
  }
</style>
