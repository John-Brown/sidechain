<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TrackConfig, TrackId, ViewerMode } from '../state/tracks.svelte.js';
  import { LOW_CONFIDENCE } from '../review.js';

  /**
   * Track label cell (184px column in the design). Grip for reorder, name,
   * pen (editable) / lock (task read-only) icons and a meta slot.
   *
   * Resize: hovering the bottom edge shows a teal bar and "↕ 48 px". Dragging
   * moves that bar as a transform-positioned guide (rAF, inline style only)
   * and commits once via onResize(id, px) on pointerup, so nothing reflows
   * mid-drag. ↑/↓ on the focused edge resize in 4px steps.
   *
   * Reorder: dragging the grip translates this cell only (inline style) and
   * calls onReorder(fromId, toId) on drop over another label of the same
   * group. ⌥↑/⌥↓ on the focused grip call onMove(id, ∓1).
   */
  interface Props {
    track: Pick<TrackConfig, 'id' | 'label' | 'group' | 'minHeight' | 'maxHeight' | 'collapsed'>;
    /** Rendered height (TrackLayoutState.renderHeight(id)) */
    height: number;
    mode?: ViewerMode;
    /** Editable in the current mode: pen icon + teal wash */
    editable?: boolean;
    /** Read-only in task mode: lock icon */
    locked?: boolean;
    /** Right-aligned meta text, e.g. "thr 0.50", "coverage 100%", "read-only" */
    meta?: string;
    /** Low-confidence blocks in view: renders the hatch swatch + "3 < .60" */
    lowConfCount?: number | null;
    /** Second line under the name (legend swatches for waveform / head pose) */
    legend?: Snippet;
    /** Extra px the resize guide extends past the label's right edge (to span the track content) */
    guideExtent?: number;
    onResize?: (id: TrackId, px: number) => void;
    onReorder?: (fromId: TrackId, toId: TrackId) => void;
    onMove?: (id: TrackId, delta: -1 | 1) => void;
    onToggleCollapse?: (id: TrackId) => void;
  }

  let {
    track,
    height,
    mode = 'view',
    editable = false,
    locked = false,
    meta,
    lowConfCount = null,
    legend,
    guideExtent = 0,
    onResize,
    onReorder,
    onMove,
    onToggleCollapse,
  }: Props = $props();

  const RESIZE_STEP = 4;
  const REORDER_THRESHOLD = 3;
  const LOW_CONF_LABEL = LOW_CONFIDENCE.toFixed(2).slice(1); // ".60"

  const isTask = $derived(mode === 'task');
  const collapsed = $derived(track.collapsed);
  const resizable = $derived(!!onResize && !collapsed);

  let rootEl: HTMLDivElement;
  let edgeEl: HTMLDivElement | undefined = $state();
  let liveReadoutEl: HTMLSpanElement | undefined = $state();

  function clamp(px: number): number {
    return Math.round(Math.min(track.maxHeight, Math.max(track.minHeight, px)));
  }

  // --- Height resize (imperative guide, commit on pointerup) ---
  let resizeStartY = 0;
  let resizeStartH = 0;
  let resizePx = 0;
  let resizing = false;
  let resizeRaf = 0;

  function handleEdgePointerDown(e: PointerEvent) {
    if (!resizable || !edgeEl || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    edgeEl.setPointerCapture(e.pointerId);
    resizing = true;
    resizeStartY = e.clientY;
    resizeStartH = height;
    resizePx = height;
    edgeEl.dataset.active = '';
    if (liveReadoutEl) liveReadoutEl.textContent = `↕ ${height} px`;
  }

  function handleEdgePointerMove(e: PointerEvent) {
    if (!resizing || !edgeEl) return;
    const clientY = e.clientY;
    const el = edgeEl;
    const readout = liveReadoutEl;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizePx = clamp(resizeStartH + (clientY - resizeStartY));
      el.style.transform = `translateY(${resizePx - resizeStartH}px)`;
      if (readout) readout.textContent = `↕ ${resizePx} px`;
    });
  }

  function finishResize(e: PointerEvent, commit: boolean) {
    if (!resizing || !edgeEl) return;
    cancelAnimationFrame(resizeRaf);
    resizing = false;
    const px = clamp(resizeStartH + (e.clientY - resizeStartY));
    edgeEl.style.transform = '';
    delete edgeEl.dataset.active;
    if (edgeEl.hasPointerCapture(e.pointerId)) edgeEl.releasePointerCapture(e.pointerId);
    if (commit && px !== resizeStartH) onResize?.(track.id, px);
  }

  function handleEdgeKeydown(e: KeyboardEvent) {
    if (!resizable || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const step = (e.shiftKey ? RESIZE_STEP * 4 : RESIZE_STEP) * (e.key === 'ArrowUp' ? -1 : 1);
    const px = clamp(height + step);
    if (px !== height) onResize?.(track.id, px);
  }

  // --- Reorder (grip drag translates this cell; commit on drop) ---
  let reorderStartY = 0;
  let reorderPending = false;
  let reordering = false;
  let reorderRaf = 0;

  function handleGripPointerDown(e: PointerEvent) {
    if (!onReorder || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    reorderPending = true;
    reordering = false;
    reorderStartY = e.clientY;
  }

  function handleGripPointerMove(e: PointerEvent) {
    if (!reorderPending) return;
    const dy = e.clientY - reorderStartY;
    if (!reordering) {
      if (Math.abs(dy) < REORDER_THRESHOLD) return;
      reordering = true;
      rootEl.style.zIndex = '20';
      rootEl.style.opacity = '0.85';
      rootEl.style.cursor = 'grabbing';
    }
    cancelAnimationFrame(reorderRaf);
    reorderRaf = requestAnimationFrame(() => {
      rootEl.style.transform = `translateY(${dy}px)`;
    });
  }

  /** Label of the same group under clientY, if any */
  function dropTarget(clientY: number): TrackId | null {
    const scope = rootEl.closest('.viewer-theme') ?? document;
    const labels = scope.querySelectorAll<HTMLElement>(
      `[data-track-label][data-track-group="${track.group}"]`,
    );
    for (const el of labels) {
      if (el === rootEl) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return (el.dataset.trackId as TrackId) ?? null;
    }
    return null;
  }

  function finishReorder(e: PointerEvent, commit: boolean) {
    if (!reorderPending) return;
    cancelAnimationFrame(reorderRaf);
    const grip = e.currentTarget as HTMLElement;
    if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
    const wasDragging = reordering;
    reorderPending = false;
    reordering = false;
    rootEl.style.transform = '';
    rootEl.style.zIndex = '';
    rootEl.style.opacity = '';
    rootEl.style.cursor = '';
    if (!commit || !wasDragging) return;
    const target = dropTarget(e.clientY);
    if (target && target !== track.id) onReorder?.(track.id, target);
  }

  function handleGripKeydown(e: KeyboardEvent) {
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    onMove?.(track.id, e.key === 'ArrowUp' ? -1 : 1);
  }
</script>

<div
  bind:this={rootEl}
  data-track-label
  data-track-id={track.id}
  data-track-group={track.group}
  class="track-label relative flex gap-1.5 pl-1.5 pr-2 border-r border-b border-viewer-border select-none {legend && !collapsed ? 'items-start pt-2' : 'items-center'}"
  class:bg-viewer-bg={!editable}
  class:track-label-editable={editable}
  style="height: {height}px"
>
  {#if collapsed}
    <button
      type="button"
      class="track-icon-btn text-viewer-text-subtle hover:text-viewer-text"
      aria-label="Expand {track.label} track"
      aria-expanded="false"
      onclick={() => onToggleCollapse?.(track.id)}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
    </button>
  {:else}
    <button
      type="button"
      class="track-icon-btn track-grip text-viewer-text-subtle hover:text-viewer-text-dim"
      aria-label="Move {track.label} track (⌥↑ / ⌥↓)"
      title="Drag to reorder · ⌥↑/↓"
      onpointerdown={handleGripPointerDown}
      onpointermove={handleGripPointerMove}
      onpointerup={(e) => finishReorder(e, true)}
      onpointercancel={(e) => finishReorder(e, false)}
      onkeydown={handleGripKeydown}
    >
      <svg width="12" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="9" cy="6" r="1.5"></circle><circle cx="15" cy="6" r="1.5"></circle><circle cx="9" cy="12" r="1.5"></circle><circle cx="15" cy="12" r="1.5"></circle><circle cx="9" cy="18" r="1.5"></circle><circle cx="15" cy="18" r="1.5"></circle></svg>
    </button>
  {/if}

  <div class="flex min-w-0 {legend && !collapsed ? 'flex-col gap-1' : 'items-center gap-1.5'}">
    <div class="flex items-center gap-1.5 min-w-0">
      <span
        class="truncate leading-none {collapsed ? 'text-viewer-sm' : 'text-viewer-base'}"
        class:text-viewer-text={!isTask || editable}
        class:text-viewer-text-dim={isTask && !editable}
        class:font-medium={isTask && editable}
        ondblclick={() => onToggleCollapse?.(track.id)}
        role="presentation"
      >{track.label}</span>
      {#if editable}
        <svg class="shrink-0 text-viewer-accent" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-label="Editable" role="img"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path></svg>
      {/if}
      {#if locked}
        <svg class="shrink-0 text-viewer-text-subtle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-label="Read-only" role="img"><rect width="18" height="11" x="3" y="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
      {/if}
    </div>
    {#if legend && !collapsed}
      {@render legend()}
    {/if}
  </div>

  <!-- ml-auto instead of a flex-1 spacer: one gap less, so "Transcription" + lock + "3<.60" fit 184px -->
  {#if lowConfCount != null}
    <span class="ml-auto shrink-0 flex items-center gap-0.5 font-mono text-viewer-xs text-viewer-text-dim {legend && !collapsed ? 'mt-0.5' : ''}">
      <span class="lowconf-swatch" aria-hidden="true"></span>{lowConfCount}&thinsp;&lt;&thinsp;{LOW_CONF_LABEL}
    </span>
  {:else if meta}
    <span class="ml-auto shrink-0 font-mono text-viewer-xs text-viewer-text-dim">{meta}</span>
  {/if}

  {#if resizable}
    <!-- A focusable separator is a widget (WAI-ARIA window splitter): ↑/↓ resize -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={edgeEl}
      class="resize-edge"
      role="separator"
      tabindex="0"
      aria-orientation="horizontal"
      aria-label="Resize {track.label} track"
      aria-valuenow={height}
      aria-valuemin={track.minHeight}
      aria-valuemax={track.maxHeight}
      style="--guide-extent: {guideExtent}px"
      onpointerdown={handleEdgePointerDown}
      onpointermove={handleEdgePointerMove}
      onpointerup={(e) => finishResize(e, true)}
      onpointercancel={(e) => finishResize(e, false)}
      onkeydown={handleEdgeKeydown}
    >
      <span class="resize-bar"></span>
      <span class="resize-readout resize-readout-static font-mono text-viewer-xs text-viewer-accent">↕ {height} px</span>
      <span bind:this={liveReadoutEl} class="resize-readout resize-readout-live font-mono text-viewer-xs text-viewer-accent"></span>
    </div>
  {/if}
</div>

<style>
  .track-label-editable {
    background-color: var(--viewer-accent-bg);
  }

  .track-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 2px;
    transition: color 150ms;
  }

  .track-grip {
    cursor: grab;
    touch-action: none;
  }

  /* 8px hatch swatch: ink 35%, dashed muted border (design `hatchSw`) */
  .lowconf-swatch {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border: 1px dashed var(--viewer-text-dim);
    background-image: repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--viewer-text) 35%, transparent) 0 1.5px,
      transparent 1.5px 4px
    );
  }

  /* Bottom-edge hit zone; the whole zone is the transform-positioned guide while dragging */
  .resize-edge {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 6px;
    cursor: row-resize;
    touch-action: none;
    z-index: 5;
  }

  .resize-bar {
    position: absolute;
    left: 0;
    right: calc(-1 * var(--guide-extent, 0px));
    bottom: -2px;
    height: 3px;
    background-color: var(--viewer-accent);
    pointer-events: none;
    display: none;
  }

  .resize-readout {
    position: absolute;
    right: 6px;
    bottom: 4px;
    white-space: nowrap;
    pointer-events: none;
    display: none;
  }

  .resize-edge:hover .resize-bar,
  .resize-edge:focus-visible .resize-bar,
  .resize-edge:global([data-active]) .resize-bar {
    display: block;
  }

  .resize-edge:hover:not([data-active]) .resize-readout-static,
  .resize-edge:focus-visible:not([data-active]) .resize-readout-static,
  .resize-edge:global([data-active]) .resize-readout-live {
    display: block;
  }
</style>
