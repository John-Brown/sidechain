<script lang="ts" generics="T extends { time_range: { start: number; end: number } }">
  import { tick } from 'svelte';
  import { getTimelineState, getEditorState, getTaskModeState } from '../context.js';
  import { binarySearchStart, binarySearchEnd } from '../utils/binary-search.js';
  import type { EditableType } from '../state/editor.svelte.js';
  import {
    type DragState,
    type DragEdge,
    computeDragPreview,
    computeFinalRange,
    validateResize,
  } from '../editing/drag-resize.js';
  import {
    getProvenance as defaultGetSource,
    isLowConfidence as defaultIsLowConfidence,
    getConfidence as defaultGetConfidence,
    type Provenance,
    type ReviewableAnnotation,
  } from '../review.js';
  import type { AnnotationSetType } from '@annotation/shared';

  /**
   * Editable block track (edit and task mode). Same block recipe as DOMTrack
   * (`blk hue-*` + data-source / data-lowconf / aria-selected / data-locked).
   *
   * Drag protocol (.claude/rules/performance.md): pointer capture, then rAF
   * writes to the dragged element's inline transform/width only. The origin
   * ghost is a single pre-rendered element positioned imperatively. Nothing
   * reactive is written until pointerup, which validates and commits.
   *
   * Handles (4px teal bars) render only on the selected, editable block. They
   * are children of the block, so they move with its transform during drag.
   *
   * Keyboard: roving tabindex (one tabbable block per track), ←/→ between
   * blocks, ↵ selects. ↵ on the selected block bubbles to the viewer (confirm).
   */

  /** Map editor field name to annotation_set type for task constraint checking */
  function editableTypeToAnnotationType(type: EditableType): AnnotationSetType {
    const map: Record<EditableType, AnnotationSetType> = {
      states: 'state',
      intents: 'intent',
      transcription: 'transcription',
      backchannels: 'backchannel',
      userLabels: 'user_labels',
    };
    return map[type];
  }

  interface Props {
    data: T[];
    editableType: EditableType;
    getStart: (item: T) => number;
    getEnd: (item: T) => number;
    /** Hue class for the block, e.g. "hue-intent-inform" */
    blockClass: (item: T) => string;
    blockLabel: (item: T) => string;
    /** `data-source`. Defaults to review.ts `getProvenance`. */
    getSource?: (item: T) => Provenance;
    /** `data-lowconf`. Defaults to review.ts `isLowConfidence`. */
    isLowConfidence?: (item: T) => boolean;
    /** Value shown on wide low-confidence blocks. Defaults to review.ts `getConfidence`. */
    getConfidence?: (item: T) => number | null;
    onBlockClick?: (item: T, index: number) => void;
    onBlockDoubleClick?: (item: T, index: number) => void;
    onBlockContextMenu?: (e: MouseEvent, item: T, index: number) => void;
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
    editableType,
    getStart,
    getEnd,
    blockClass,
    blockLabel,
    getSource = (item: T) => defaultGetSource(item as unknown as ReviewableAnnotation),
    isLowConfidence = (item: T) => defaultIsLowConfidence(item as unknown as ReviewableAnnotation),
    getConfidence = (item: T) => defaultGetConfidence(item as unknown as ReviewableAnnotation),
    onBlockClick,
    onBlockDoubleClick,
    onBlockContextMenu,
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
  /** Move threshold (px) that distinguishes a click from a drag */
  const MOVE_THRESHOLD = 3;

  const timeline = getTimelineState();
  const editor = getEditorState();
  const taskMode = getTaskModeState();

  const annotationType = $derived(editableTypeToAnnotationType(editableType));

  // --- Drag state (non-reactive, managed imperatively during drag) ---
  let dragState: DragState | null = null;
  let rafId = 0;
  let dragEl: HTMLElement | null = null;
  /** Track if we've exceeded the move threshold to distinguish click from drag */
  let dragStarted = false;

  let containerEl: HTMLDivElement;
  /** Origin ghost, shown and positioned imperatively during a drag */
  let ghostEl: HTMLDivElement;

  /** Data index of the roving-tabindex block (last focused or clicked) */
  let focusIndex = $state(-1);

  // Selection reads from shared editor state
  const isSelectedTrack = $derived(editor.selectedType === editableType);
  const selectedIndex = $derived(isSelectedTrack ? editor.selectedIndex : null);

  /** Whether blocks on this track may be resized/moved at all (task constraints) */
  const trackEditable = $derived(
    !taskMode.active ||
      (taskMode.isTypeEditable(annotationType) && taskMode.isOperationAllowed('resize')),
  );

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
      const lowconf = isLowConfidence(item);
      const c = lowconf && width > CONF_MIN_WIDTH ? getConfidence(item) : null;
      result.push({
        item,
        left: timeline.timeToPx(start),
        width,
        label: blockLabel(item),
        hueClass: blockClass(item),
        source: getSource(item),
        lowconf,
        conf: c != null ? c.toFixed(2).slice(1) : '',
        locked: taskMode.active && taskMode.isTimeLocked(item.time_range),
        index: i,
      });
    }
    return result;
  });

  /** The one block with tabindex=0: focus index, else the selected block, else the first visible */
  const tabbableIndex = $derived.by(() => {
    const n = visibleBlocks.length;
    if (n === 0) return -1;
    const first = visibleBlocks[0].index;
    const last = visibleBlocks[n - 1].index;
    if (focusIndex >= first && focusIndex <= last) return focusIndex;
    if (selectedIndex != null && selectedIndex >= first && selectedIndex <= last) return selectedIndex;
    return first;
  });

  function canDrag(item: T): boolean {
    return trackEditable && !(taskMode.active && taskMode.isTimeLocked(item.time_range));
  }

  // --- Drag helpers (imperative, no reactivity) ---

  function beginDrag(el: HTMLElement, e: PointerEvent, edge: DragEdge, index: number, item: T) {
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

  /** Called once the drag is real (handles: immediately; move: after the threshold) */
  function showDragChrome() {
    if (!dragState || !dragEl) return;
    ghostEl.style.transform = `translateX(${dragState.originalLeftPx}px)`;
    ghostEl.style.width = `${Math.max(dragState.originalWidthPx - BLOCK_GAP, 2)}px`;
    ghostEl.style.display = 'block';
    dragEl.style.zIndex = '4';
    dragEl.style.cursor = dragState.edge === 'move' ? 'grabbing' : 'col-resize';
  }

  function endDrag(pointerId: number) {
    cancelAnimationFrame(rafId);
    ghostEl.style.display = 'none';
    if (dragEl) {
      dragEl.style.zIndex = '';
      dragEl.style.cursor = '';
      if (dragEl.hasPointerCapture(pointerId)) dragEl.releasePointerCapture(pointerId);
    }
    dragState = null;
    dragEl = null;
    dragStarted = false;
  }

  function snapBack(el: HTMLElement, drag: DragState) {
    el.style.transform = `translateX(${drag.originalLeftPx}px)`;
    el.style.width = `${Math.max(drag.originalWidthPx - BLOCK_GAP, 2)}px`;
  }

  // --- Drag handlers ---
  function handleHandlePointerDown(e: PointerEvent, edge: DragEdge, index: number, item: T) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!canDrag(item)) return;

    const el = (e.currentTarget as HTMLElement).closest('[data-block-index]') as HTMLElement | null;
    if (!el) return;

    beginDrag(el, e, edge, index, item);
    dragStarted = true; // Handle drags start immediately (no threshold)
    showDragChrome();
  }

  function handleBlockPointerDown(e: PointerEvent, index: number, item: T) {
    // Don't initiate move if a handle captured it
    if (dragState || e.button !== 0) return;
    if (!canDrag(item)) return;

    e.preventDefault();
    beginDrag(e.currentTarget as HTMLElement, e, 'move', index, item);
    dragStarted = false; // Wait for threshold before committing to drag
  }

  function handleBlockPointerMove(e: PointerEvent) {
    if (!dragState || !dragEl) return;

    // For move drags, require threshold before committing
    if (!dragStarted) {
      if (Math.abs(e.clientX - dragState.startX) < MOVE_THRESHOLD) return;
      dragStarted = true;
      showDragChrome();
    }

    cancelAnimationFrame(rafId);
    const clientX = e.clientX;
    const el = dragEl;
    const drag = dragState;
    const zoom = timeline.zoom;

    rafId = requestAnimationFrame(() => {
      const preview = computeDragPreview(drag, clientX, zoom);
      // Direct DOM mutation — no Svelte reactivity
      el.style.transform = `translateX(${preview.translateX}px)`;
      el.style.width = `${Math.max(preview.width - BLOCK_GAP, 2)}px`;
    });
  }

  function handleBlockPointerUp(e: PointerEvent) {
    if (!dragState || !dragEl) return;

    cancelAnimationFrame(rafId);
    const el = dragEl;
    const drag = dragState;

    // If move threshold wasn't met, treat as click (not drag)
    if (!dragStarted) {
      endDrag(e.pointerId);
      return;
    }

    const newRange = computeFinalRange(drag, e.clientX, timeline.zoom, timeline.duration);

    // Build time_range-compatible array for overlap checking
    const items = data.map((item) => ({
      time_range: { start: getStart(item), end: getEnd(item) },
    }));

    const valid =
      validateResize(newRange, drag.index, items, timeline.duration, drag.edge) &&
      // Task mode: cannot extend into locked time ranges
      !(taskMode.active && taskMode.isTimeLocked(newRange));

    if (valid) {
      // Push undo snapshot before committing
      editor.pushUndo(editableType);

      const currentArray = editor[editableType];
      // Snapshot before state for audit trail
      const beforeSnapshot = currentArray ? structuredClone($state.snapshot(currentArray)) : null;

      // Commit: update the item's time_range in the editor's data
      const item = data[drag.index];
      item.time_range.start = newRange.start;
      item.time_range.end = newRange.end;

      // Match the committed geometry now, so the re-render below is a no-op
      el.style.transform = `translateX(${timeline.timeToPx(newRange.start)}px)`;
      el.style.width = `${Math.max(timeline.timeToPx(newRange.end - newRange.start) - BLOCK_GAP, 2)}px`;

      // Trigger reactivity by reassigning the array
      const newArray = [...data];
      (editor as unknown as Record<string, unknown>)[editableType] = newArray;

      // Record edit for audit trail
      editor.recordEdit(editableType, {
        editType: 'resize',
        targetIndex: drag.index,
        beforeState: beforeSnapshot,
        afterState: structuredClone($state.snapshot(newArray)),
      });
      if (taskMode.active) taskMode.recordEdit();

      editor.lastEditedType = editableType;
      editor.markDirty(editableType);
    } else {
      snapBack(el, drag);
    }

    endDrag(e.pointerId);
  }

  function handleBlockPointerCancel(e: PointerEvent) {
    if (!dragState || !dragEl) return;
    cancelAnimationFrame(rafId);
    if (dragStarted) snapBack(dragEl, dragState);
    endDrag(e.pointerId);
  }

  // --- Selection + keyboard ---

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

  function selectBlock(item: T, index: number, el: HTMLElement | null) {
    focusIndex = index;
    el?.focus({ preventScroll: true });
    editor.select(editableType, index);
    onBlockClick?.(item, index);
  }

  function handleBlockClick(e: MouseEvent, item: T, index: number) {
    selectBlock(item, index, e.currentTarget as HTMLElement);
  }

  function handleBlockDblClick(_e: MouseEvent, item: T, index: number) {
    onBlockDoubleClick?.(item, index);
  }

  function handleBlockContextMenu(e: MouseEvent, item: T, index: number) {
    e.preventDefault();
    focusIndex = index;
    editor.select(editableType, index);
    onBlockContextMenu?.(e, item, index);
  }

  function handleBlockKeydown(e: KeyboardEvent, item: T, index: number) {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const next = index + (e.key === 'ArrowLeft' ? -1 : 1);
      e.preventDefault();
      e.stopPropagation();
      if (next >= 0 && next < data.length) focusBlock(next);
    } else if (e.key === 'Enter') {
      // Already selected: let ↵ bubble to the viewer (confirm)
      if (selectedIndex === index) return;
      e.preventDefault();
      e.stopPropagation();
      selectBlock(item, index, e.currentTarget as HTMLElement);
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
  <!-- Drag origin ghost: static, positioned imperatively on drag start -->
  <div
    bind:this={ghostEl}
    class="blk-ghost absolute left-0"
    style="display: none; top: {inset}px; bottom: {inset}px;"
    aria-hidden="true"
  ></div>

  {#each visibleBlocks as block (block.index)}
    {@const selected = selectedIndex === block.index}
    {@const draggable = trackEditable && !block.locked}
    <div
      data-block-index={block.index}
      class="blk {block.hueClass} editable-block absolute flex items-center text-viewer-sm leading-none whitespace-nowrap select-none"
      class:editable-block-draggable={draggable}
      style="transform: translateX({block.left}px); width: {block.width}px; top: {inset}px; bottom: {inset}px; padding: 0 {padX}px;"
      role="option"
      aria-selected={selected}
      tabindex={block.index === tabbableIndex ? 0 : -1}
      data-source={block.source}
      data-lowconf={block.lowconf ? '' : undefined}
      data-locked={block.locked ? '' : undefined}
      onclick={(e) => handleBlockClick(e, block.item, block.index)}
      ondblclick={(e) => handleBlockDblClick(e, block.item, block.index)}
      oncontextmenu={(e) => handleBlockContextMenu(e, block.item, block.index)}
      onkeydown={(e) => handleBlockKeydown(e, block.item, block.index)}
      onpointerdown={(e) => handleBlockPointerDown(e, block.index, block.item)}
      onpointermove={handleBlockPointerMove}
      onpointerup={handleBlockPointerUp}
      onpointercancel={handleBlockPointerCancel}
    >
      {#if block.width > minLabelWidth}
        <span class="blk-text pointer-events-none">{block.label}</span>
        {#if block.conf}
          <span class="ml-auto pl-1 font-mono text-viewer-xs pointer-events-none">{block.conf}</span>
        {/if}
      {/if}

      {#if selected && draggable}
        <span
          role="presentation"
          class="blk-handle blk-handle-start editable-handle"
          onpointerdown={(e) => handleHandlePointerDown(e, 'left', block.index, block.item)}
        ></span>
        <span
          role="presentation"
          class="blk-handle blk-handle-end editable-handle"
          onpointerdown={(e) => handleHandlePointerDown(e, 'right', block.index, block.item)}
        ></span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .editable-block {
    will-change: transform;
    contain: layout style;
    cursor: pointer;
  }

  .editable-block-draggable {
    cursor: grab;
  }

  .blk-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: clip;
  }

  .editable-handle {
    cursor: col-resize;
    z-index: 1;
  }

  /* Wider invisible hit area around the 4px bar (the block itself doesn't clip) */
  .editable-handle::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    right: -3px;
  }
</style>
