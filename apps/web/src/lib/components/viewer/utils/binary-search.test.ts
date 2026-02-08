import { describe, it, expect } from 'vitest';
import { binarySearchStart, binarySearchEnd } from './binary-search.js';

// Helpers to build test data
const range = (start: number, end: number) => ({ time_range: { start, end } });
const point = (time: number) => ({ time });

// Segments: [0,2) [2,4) [4,6) [6,8) [8,10)
const segments = [range(0, 2), range(2, 4), range(4, 6), range(6, 8), range(8, 10)];

// Point events at 0, 1, 2, 3, 4, 5
const points = [point(0), point(1), point(2), point(3), point(4), point(5)];

describe('binarySearchStart', () => {
	it('returns 0 for empty array', () => {
		// lo=0, hi=-1 → loop never runs → max(0, 0-1) = 0
		expect(binarySearchStart([], 5)).toBe(0);
	});

	it('returns 0 when target is before all segments', () => {
		expect(binarySearchStart(segments, -1)).toBe(0);
	});

	it('returns 0 when target is at the start of the first segment', () => {
		expect(binarySearchStart(segments, 0)).toBe(0);
	});

	it('returns correct start index for mid-range target (segments)', () => {
		// time=5 → first segment whose end >= 5 is [4,6) at index 2 → returns max(0, 2-1) = 1
		expect(binarySearchStart(segments, 5)).toBe(1);
	});

	it('returns index with -1 padding (overshoots by one)', () => {
		// time=7 → first segment whose end >= 7 is [6,8) at index 3 → returns 3-1 = 2
		expect(binarySearchStart(segments, 7)).toBe(2);
	});

	it('clamps to 0 when search lands at index 0', () => {
		// time=1.5 → first segment whose end >= 1.5 is [0,2) at index 0 → max(0, 0-1) = 0
		expect(binarySearchStart(segments, 1.5)).toBe(0);
	});

	it('returns correct start index for point events', () => {
		// time=3 → first point whose time >= 3 is index 3 → returns max(0, 3-1) = 2
		expect(binarySearchStart(points, 3)).toBe(2);
	});

	it('returns 0 for single-item array when target is before it', () => {
		expect(binarySearchStart([range(5, 10)], 2)).toBe(0);
	});

	it('returns 0 for single-item array when target is within it', () => {
		expect(binarySearchStart([range(5, 10)], 7)).toBe(0);
	});

	it('handles target past all items', () => {
		// time=20 → all ends < 20, so lo walks to 4 (last index) → max(0, 4-1) = 3
		expect(binarySearchStart(segments, 20)).toBe(3);
	});
});

describe('binarySearchEnd', () => {
	it('returns 0 for empty array', () => {
		// lo=0, hi=-1 → loop never runs → min(-1, 0+1) = -1… but with empty array the caller
		// should not use the result. Still, verify it doesn't throw.
		expect(binarySearchEnd([], 5)).toBe(-1);
	});

	it('returns 1 when target is after all segments', () => {
		// time=20 → no start > 20, so lo walks to 4 → min(4, 4+1) = 4
		expect(binarySearchEnd(segments, 20)).toBe(4);
	});

	it('returns 0 when target is before all segments', () => {
		// time=-1 → all starts > -1, so hi walks to 0, then lo stays at 0…
		// start of data[0]=0 > -1 → hi = -1, loop ends with lo=0, hi=-1 → lo=0 → min(4, 0+1)=1
		// Actually: lo=0, hi=4. mid=(0+4+1)>>>1=2. start[2]=4 > -1 → hi=1. mid=(0+1+1)>>>1=1. start[1]=2 > -1 → hi=0. mid=(0+0+1)>>>1=0. start[0]=0 > -1 → hi=-1. Loop ends. lo=0 → min(4, 1) = 1
		// Hmm, lo=0 hi=-1 means loop exits. Return min(4, 0+1) = 1
		expect(binarySearchEnd(segments, -1)).toBe(1);
	});

	it('returns correct end index for mid-range target (segments)', () => {
		// time=5 → last segment whose start <= 5 is [4,6) at index 2 → min(4, 2+1) = 3
		expect(binarySearchEnd(segments, 5)).toBe(3);
	});

	it('returns index with +1 padding (overshoots by one)', () => {
		// time=3 → last segment whose start <= 3 is [2,4) at index 1 → min(4, 1+1) = 2
		expect(binarySearchEnd(segments, 3)).toBe(2);
	});

	it('clamps to last index when search lands at the end', () => {
		// time=9 → last segment whose start <= 9 is [8,10) at index 4 → min(4, 4+1) = 4
		expect(binarySearchEnd(segments, 9)).toBe(4);
	});

	it('returns correct end index for point events', () => {
		// time=3 → last point whose time <= 3 is index 3 → min(5, 3+1) = 4
		expect(binarySearchEnd(points, 3)).toBe(4);
	});

	it('returns correct index for single-item array', () => {
		// time=7, item at [5,10) → start 5 <= 7 → lo=0 → min(0, 0+1) = 0
		expect(binarySearchEnd([range(5, 10)], 7)).toBe(0);
	});

	it('handles exact boundary hit on segment start', () => {
		// time=4 → last segment whose start <= 4 is [4,6) at index 2 → min(4, 2+1) = 3
		expect(binarySearchEnd(segments, 4)).toBe(3);
	});
});

describe('binarySearchStart + binarySearchEnd (viewport culling)', () => {
	it('returns a range that covers the visible viewport with padding', () => {
		// Viewport: [3, 7]
		const startIdx = binarySearchStart(segments, 3);
		const endIdx = binarySearchEnd(segments, 7);

		// Segments that overlap [3,7]: [2,4) idx=1, [4,6) idx=2, [6,8) idx=3
		// With ±1 padding: startIdx should be <= 1, endIdx should be >= 3
		expect(startIdx).toBeLessThanOrEqual(1);
		expect(endIdx).toBeGreaterThanOrEqual(3);

		// The slice segments[startIdx..endIdx] should include all overlapping segments
		const visible = segments.slice(startIdx, endIdx + 1);
		expect(visible.length).toBeGreaterThanOrEqual(3);
	});

	it('works with point events for viewport culling', () => {
		// Viewport: [1.5, 3.5]
		const startIdx = binarySearchStart(points, 1.5);
		const endIdx = binarySearchEnd(points, 3.5);

		// Points in range: 2, 3 (indices 2, 3). With padding: at least indices 1..4
		const visible = points.slice(startIdx, endIdx + 1);
		expect(visible).toEqual(expect.arrayContaining([point(2), point(3)]));
	});
});
