import type { TimeRange } from '@annotation/shared';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTimeRange(range: TimeRange, duration: number): ValidationResult {
  const errors: string[] = [];
  if (range.start < 0) errors.push('Start time cannot be negative');
  if (range.end > duration) errors.push('End time exceeds video duration');
  if (range.end - range.start < 0.05) errors.push('Minimum duration is 50ms');
  if (range.start >= range.end) errors.push('Start must be before end');
  return { valid: errors.length === 0, errors };
}

export function checkOverlap(
  items: { time_range: TimeRange }[],
  index: number,
  newRange: TimeRange,
): boolean {
  const prev = items[index - 1];
  if (prev && prev.time_range.end > newRange.start) return true;
  const next = items[index + 1];
  if (next && next.time_range.start < newRange.end) return true;
  return false;
}

export interface MoveOverlapResult {
  overlaps: boolean;
  overlapIndex?: number;
}

/**
 * Check all items (except the moved one) for overlap with a proposed new range.
 * Unlike checkOverlap which only checks immediate neighbors (sufficient for resize),
 * move operations can jump far, so an O(n) scan is necessary. n is small in practice.
 */
export function checkMoveOverlap(
  items: { time_range: TimeRange }[],
  movedIndex: number,
  newStart: number,
  newEnd: number,
): MoveOverlapResult {
  for (let i = 0; i < items.length; i++) {
    if (i === movedIndex) continue;
    const item = items[i].time_range;
    // Half-open interval overlap: [newStart, newEnd) overlaps [item.start, item.end)
    if (newStart < item.end && newEnd > item.start) {
      return { overlaps: true, overlapIndex: i };
    }
  }
  return { overlaps: false };
}

export function checkContiguity(
  items: { time_range: TimeRange }[],
  tolerance = 0.1,
): { valid: boolean; gaps: TimeRange[] } {
  const gaps: TimeRange[] = [];
  for (let i = 0; i < items.length - 1; i++) {
    const gapStart = items[i].time_range.end;
    const gapEnd = items[i + 1].time_range.start;
    if (gapEnd - gapStart > tolerance) {
      gaps.push({ start: gapStart, end: gapEnd });
    }
  }
  return { valid: gaps.length === 0, gaps };
}

export function isInLockedRange(
  range: TimeRange,
  lockedRanges: TimeRange[],
): boolean {
  for (const locked of lockedRanges) {
    if (range.start < locked.end && range.end > locked.start) return true;
  }
  return false;
}

/**
 * Validate that annotations cover the full timeline (for contiguous types like states).
 * Checks: starts at 0, ends at duration, no internal gaps.
 */
export function validateCoverage(
  items: { time_range: TimeRange }[],
  totalDuration: number,
  tolerance = 0.1,
): ValidationResult {
  const errors: string[] = [];
  if (items.length === 0) return { valid: false, errors: ['No annotations'] };

  if (items[0].time_range.start > tolerance) {
    errors.push(`Starts late: ${items[0].time_range.start.toFixed(2)}s`);
  }
  if (items[items.length - 1].time_range.end < totalDuration - tolerance) {
    errors.push(`Ends early: missing last ${(totalDuration - items[items.length - 1].time_range.end).toFixed(2)}s`);
  }

  const { gaps } = checkContiguity(items, tolerance);
  for (const gap of gaps) {
    errors.push(`Gap at ${gap.start.toFixed(2)}s (${(gap.end - gap.start).toFixed(2)}s)`);
  }

  return { valid: errors.length === 0, errors };
}
