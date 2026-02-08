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
