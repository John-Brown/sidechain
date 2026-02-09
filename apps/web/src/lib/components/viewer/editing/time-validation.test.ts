import { describe, it, expect } from 'vitest';
import {
	validateTimeRange,
	checkOverlap,
	checkMoveOverlap,
	checkContiguity,
	isInLockedRange,
	validateCoverage,
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

	describe('checkMoveOverlap', () => {
		// Sparse items with gaps: [0,2) [5,8) [10,13) [18,20)
		const sparse = [mkItem(0, 2), mkItem(5, 8), mkItem(10, 13), mkItem(18, 20)];

		it('detects overlap when moving far past neighbors', () => {
			// Move index=0 from [0,2) to [11,13) — overlaps index=2 [10,13)
			const result = checkMoveOverlap(sparse, 0, 11, 13);
			expect(result.overlaps).toBe(true);
			expect(result.overlapIndex).toBe(2);
		});

		it('detects overlap when move would create out-of-order items', () => {
			// Move index=3 from [18,20) backward to [6,8) — overlaps index=1 [5,8)
			const result = checkMoveOverlap(sparse, 3, 6, 8);
			expect(result.overlaps).toBe(true);
			expect(result.overlapIndex).toBe(1);
		});

		it('returns no overlap for valid move to empty space', () => {
			// Move index=0 from [0,2) to [3,5) — fits in gap between items 0 and 1
			const result = checkMoveOverlap(sparse, 0, 3, 5);
			expect(result.overlaps).toBe(false);
			expect(result.overlapIndex).toBeUndefined();
		});

		it('returns no overlap when moved to end of timeline', () => {
			// Move index=1 from [5,8) to [25,28) — past all items
			const result = checkMoveOverlap(sparse, 1, 25, 28);
			expect(result.overlaps).toBe(false);
		});

		it('detects partial overlap (new range straddles existing item start)', () => {
			// Move index=0 to [9,12) — partially overlaps index=2 [10,13)
			const result = checkMoveOverlap(sparse, 0, 9, 12);
			expect(result.overlaps).toBe(true);
			expect(result.overlapIndex).toBe(2);
		});

		it('allows exact boundary adjacency (half-open intervals)', () => {
			// Move index=0 to [8,10) — ends exactly where index=2 starts → no overlap
			const result = checkMoveOverlap(sparse, 0, 8, 10);
			expect(result.overlaps).toBe(false);
		});

		it('handles single-item array', () => {
			const single = [mkItem(5, 10)];
			const result = checkMoveOverlap(single, 0, 20, 25);
			expect(result.overlaps).toBe(false);
		});
	});

	describe('validateCoverage', () => {
		it('validates full coverage', () => {
			const items = [mkItem(0, 5), mkItem(5, 10), mkItem(10, 15)];
			const result = validateCoverage(items, 15);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('rejects empty annotations', () => {
			const result = validateCoverage([], 10);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain('No annotations');
		});

		it('detects late start', () => {
			const items = [mkItem(1, 5), mkItem(5, 10)];
			const result = validateCoverage(items, 10);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes('Starts late'))).toBe(true);
		});

		it('detects early end', () => {
			const items = [mkItem(0, 5), mkItem(5, 8)];
			const result = validateCoverage(items, 10);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes('Ends early'))).toBe(true);
		});

		it('detects internal gaps', () => {
			const items = [mkItem(0, 3), mkItem(5, 10)];
			const result = validateCoverage(items, 10);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes('Gap at'))).toBe(true);
		});

		it('allows small gaps within tolerance', () => {
			const items = [mkItem(0.05, 5), mkItem(5.05, 10)];
			const result = validateCoverage(items, 10.05, 0.1);
			expect(result.valid).toBe(true);
		});

		it('reports multiple errors', () => {
			const items = [mkItem(1, 3), mkItem(5, 8)];
			const result = validateCoverage(items, 10);
			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThanOrEqual(3);
		});
	});
});
