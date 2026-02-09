import { describe, it, expect } from 'vitest';
import {
	validateTimeRange,
	checkOverlap,
	checkContiguity,
	isInLockedRange,
} from './time-validation';

const mkItem = (start: number, end: number) => ({ time_range: { start, end } });

describe('time validation', () => {
	describe('validateTimeRange', () => {
		it('accepts a valid range', () => {
			const result = validateTimeRange({ start: 1, end: 5 }, 60);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('rejects annotation shorter than 50ms minimum duration', () => {
			const result = validateTimeRange({ start: 1, end: 1.03 }, 60);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Minimum duration is 50ms');
		});

		it('accepts annotation exactly 50ms', () => {
			const result = validateTimeRange({ start: 1, end: 1.05 }, 60);
			expect(result.valid).toBe(true);
		});

		it('rejects annotation with start < 0', () => {
			const result = validateTimeRange({ start: -0.5, end: 1 }, 60);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Start time cannot be negative');
		});

		it('rejects annotation with end > duration', () => {
			const result = validateTimeRange({ start: 55, end: 65 }, 60);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('End time exceeds video duration');
		});

		it('rejects annotation where start >= end', () => {
			const result = validateTimeRange({ start: 5, end: 5 }, 60);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Start must be before end');
		});

		it('collects multiple errors', () => {
			const result = validateTimeRange({ start: -1, end: 100 }, 60);
			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThanOrEqual(1);
			expect(result.errors).toContain('Start time cannot be negative');
			expect(result.errors).toContain('End time exceeds video duration');
		});
	});

	describe('checkOverlap', () => {
		const segments = [mkItem(0, 5), mkItem(5, 10), mkItem(10, 15)];

		it('detects overlap with previous annotation', () => {
			// Expanding index=1 leftward into index=0's range
			expect(checkOverlap(segments, 1, { start: 3, end: 10 })).toBe(true);
		});

		it('detects overlap with next annotation', () => {
			// Expanding index=1 rightward into index=2's range
			expect(checkOverlap(segments, 1, { start: 5, end: 12 })).toBe(true);
		});

		it('returns false when no overlap exists', () => {
			expect(checkOverlap(segments, 1, { start: 5, end: 10 })).toBe(false);
		});

		it('returns false for first item with no predecessor', () => {
			expect(checkOverlap(segments, 0, { start: 0, end: 5 })).toBe(false);
		});

		it('returns false for last item with no successor', () => {
			expect(checkOverlap(segments, 2, { start: 10, end: 15 })).toBe(false);
		});

		it('detects overlap when ranges share a boundary (half-open violation)', () => {
			// Prev ends at 5, new starts at 4.9 — overlaps
			expect(checkOverlap(segments, 1, { start: 4.9, end: 10 })).toBe(true);
		});
	});

	describe('checkContiguity', () => {
		it('validates contiguous coverage for state annotations', () => {
			const contiguous = [mkItem(0, 5), mkItem(5, 10), mkItem(10, 15)];
			const result = checkContiguity(contiguous);
			expect(result.valid).toBe(true);
			expect(result.gaps).toHaveLength(0);
		});

		it('detects gap between annotations', () => {
			const gapped = [mkItem(0, 5), mkItem(6, 10), mkItem(10, 15)];
			const result = checkContiguity(gapped);
			expect(result.valid).toBe(false);
			expect(result.gaps).toHaveLength(1);
			expect(result.gaps[0]).toEqual({ start: 5, end: 6 });
		});

		it('allows small gaps within tolerance', () => {
			const almostContiguous = [mkItem(0, 5), mkItem(5.08, 10)];
			const result = checkContiguity(almostContiguous, 0.1);
			expect(result.valid).toBe(true);
		});

		it('detects gap exactly at tolerance boundary', () => {
			// Gap of 0.15s with default tolerance of 0.1s — should fail
			const gapped = [mkItem(0, 5), mkItem(5.15, 10)];
			const result = checkContiguity(gapped);
			expect(result.valid).toBe(false);
			expect(result.gaps).toHaveLength(1);
		});

		it('handles single item (trivially contiguous)', () => {
			const result = checkContiguity([mkItem(0, 10)]);
			expect(result.valid).toBe(true);
			expect(result.gaps).toHaveLength(0);
		});

		it('handles empty array', () => {
			const result = checkContiguity([]);
			expect(result.valid).toBe(true);
			expect(result.gaps).toHaveLength(0);
		});

		it('detects multiple gaps', () => {
			const gapped = [mkItem(0, 2), mkItem(3, 5), mkItem(7, 10)];
			const result = checkContiguity(gapped);
			expect(result.valid).toBe(false);
			expect(result.gaps).toHaveLength(2);
		});
	});

	describe('isInLockedRange', () => {
		const lockedRanges = [
			{ start: 0, end: 5 },
			{ start: 20, end: 30 },
		];

		it('enforces locked region boundaries in task mode', () => {
			// Fully inside a locked range
			expect(isInLockedRange({ start: 1, end: 3 }, lockedRanges)).toBe(true);
		});

		it('detects partial overlap with locked range', () => {
			// Overlaps the end of the first locked range
			expect(isInLockedRange({ start: 3, end: 8 }, lockedRanges)).toBe(true);
		});

		it('returns false when completely outside all locked ranges', () => {
			expect(isInLockedRange({ start: 10, end: 15 }, lockedRanges)).toBe(false);
		});

		it('returns false when adjacent but not overlapping', () => {
			// Starts exactly where first locked range ends — half-open, no overlap
			expect(isInLockedRange({ start: 5, end: 10 }, lockedRanges)).toBe(false);
		});

		it('detects overlap with second locked range', () => {
			expect(isInLockedRange({ start: 25, end: 35 }, lockedRanges)).toBe(true);
		});

		it('returns false with no locked ranges', () => {
			expect(isInLockedRange({ start: 0, end: 100 }, [])).toBe(false);
		});
	});
});
