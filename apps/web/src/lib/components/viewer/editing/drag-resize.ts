import type { TimeRange } from '@annotation/shared';
import { validateTimeRange, checkOverlap } from './time-validation.js';

export type DragEdge = 'left' | 'right';

export interface DragState {
  edge: DragEdge;
  index: number;
  startX: number;
  originalRange: TimeRange;
  /** Pixel offset of the block's left edge at drag start (for computing inline styles) */
  originalLeftPx: number;
  /** Pixel width of the block at drag start */
  originalWidthPx: number;
}

export interface DragPreview {
  /** CSS transform translateX value (px) */
  translateX: number;
  /** CSS width value (px) */
  width: number;
}

/**
 * Compute inline style updates for a drag preview.
 * This is called in rAF during drag — must be fast, no allocations beyond return object.
 */
export function computeDragPreview(
  drag: DragState,
  clientX: number,
  zoom: number,
): DragPreview {
  const deltaPx = clientX - drag.startX;

  if (drag.edge === 'left') {
    // Moving start edge: translateX changes, width adjusts inversely
    const clampedDelta = Math.min(deltaPx, drag.originalWidthPx - minWidthPx(zoom));
    return {
      translateX: drag.originalLeftPx + clampedDelta,
      width: drag.originalWidthPx - clampedDelta,
    };
  } else {
    // Moving end edge: translateX stays, width changes
    const newWidth = Math.max(drag.originalWidthPx + deltaPx, minWidthPx(zoom));
    return {
      translateX: drag.originalLeftPx,
      width: newWidth,
    };
  }
}

/**
 * Compute the final time range after a drag completes.
 * Clamps to [0, duration] and enforces minimum 50ms.
 */
export function computeFinalRange(
  drag: DragState,
  clientX: number,
  zoom: number,
  duration: number,
): TimeRange {
  const deltaPx = clientX - drag.startX;
  const deltaTime = deltaPx / zoom;

  let start = drag.originalRange.start;
  let end = drag.originalRange.end;

  if (drag.edge === 'left') {
    start = drag.originalRange.start + deltaTime;
  } else {
    end = drag.originalRange.end + deltaTime;
  }

  // Clamp to timeline bounds
  start = Math.max(0, Math.min(start, duration));
  end = Math.max(0, Math.min(end, duration));

  // Enforce minimum duration (50ms)
  if (end - start < 0.05) {
    if (drag.edge === 'left') {
      start = end - 0.05;
    } else {
      end = start + 0.05;
    }
  }

  return { start, end };
}

/**
 * Validate whether a resize result can be committed.
 * Returns true if valid, false if the drag should snap back.
 */
export function validateResize(
  newRange: TimeRange,
  index: number,
  items: { time_range: TimeRange }[],
  duration: number,
): boolean {
  const rangeResult = validateTimeRange(newRange, duration);
  if (!rangeResult.valid) return false;

  if (checkOverlap(items, index, newRange)) return false;

  return true;
}

/** Minimum block width in pixels for a given zoom level (50ms minimum) */
function minWidthPx(zoom: number): number {
  return 0.05 * zoom;
}
