import { describe, it, expect } from 'vitest';
import {
	computeDragPreview,
	computeFinalRange,
	validateResize,
	type DragState,
} from './drag-resize';

const mkDrag = (edge: 'left' | 'right' | 'move', overrides?: Partial<DragState>): DragState => ({
	edge,
	index: 1,
	startX: 200,
	originalRange: { start: 5, end: 10 },
	originalLeftPx: 100,
	originalWidthPx: 100,
	...overrides,
});

const zoom = 20; // 20px per second

describe('computeDragPreview', () => {
	describe('right edge', () => {
		it('increases width when dragging right', () => {
			const drag = mkDrag('right');
			const result = computeDragPreview(drag, 250, zoom); // +50px
			expect(result.translateX).toBe(100); // unchanged
			expect(result.width).toBe(150);
		});

		it('decreases width when dragging left', () => {
			const drag = mkDrag('right');
			const result = computeDragPreview(drag, 170, zoom); // -30px
			expect(result.translateX).toBe(100);
			expect(result.width).toBe(70);
		});

		it('clamps width to minimum (50ms * zoom)', () => {
			const drag = mkDrag('right');
			// Drag far left to collapse the block
			const result = computeDragPreview(drag, 50, zoom); // -150px
			const minWidth = 0.05 * zoom; // 1px
			expect(result.width).toBe(minWidth);
		});
	});

	describe('left edge', () => {
		it('shifts left and grows width when dragging left', () => {
			const drag = mkDrag('left');
			const result = computeDragPreview(drag, 170, zoom); // -30px
			expect(result.translateX).toBe(70); // 100 - 30
			expect(result.width).toBe(130); // 100 + 30
		});

		it('shifts right and shrinks width when dragging right', () => {
			const drag = mkDrag('left');
			const result = computeDragPreview(drag, 230, zoom); // +30px
			expect(result.translateX).toBe(130); // 100 + 30
			expect(result.width).toBe(70); // 100 - 30
		});

		it('clamps to minimum width when dragging right far', () => {
			const drag = mkDrag('left');
			const minWidth = 0.05 * zoom;
			// Drag right beyond the block width
			const result = computeDragPreview(drag, 500, zoom); // +300px, way past originalWidthPx
			expect(result.width).toBe(minWidth);
			expect(result.translateX).toBe(100 + (100 - minWidth)); // clamped delta
		});
	});

	describe('move', () => {
		it('shifts translateX while keeping width constant', () => {
			const drag = mkDrag('move');
			const result = computeDragPreview(drag, 250, zoom); // +50px
			expect(result.translateX).toBe(150); // 100 + 50
			expect(result.width).toBe(100); // unchanged
		});

		it('shifts left when dragging left', () => {
			const drag = mkDrag('move');
			const result = computeDragPreview(drag, 170, zoom); // -30px
			expect(result.translateX).toBe(70); // 100 - 30
			expect(result.width).toBe(100); // unchanged
		});
	});

	it('no movement returns original dimensions', () => {
		const drag = mkDrag('right');
		const result = computeDragPreview(drag, 200, zoom); // 0px delta
		expect(result.translateX).toBe(100);
		expect(result.width).toBe(100);
	});
});

describe('computeFinalRange', () => {
	const duration = 60;

	it('extends end when dragging right edge right', () => {
		const drag = mkDrag('right');
		const result = computeFinalRange(drag, 260, zoom, duration); // +60px = +3s
		expect(result.start).toBe(5);
		expect(result.end).toBeCloseTo(13); // 10 + 3
	});

	it('shrinks end when dragging right edge left', () => {
		const drag = mkDrag('right');
		const result = computeFinalRange(drag, 140, zoom, duration); // -60px = -3s
		expect(result.start).toBe(5);
		expect(result.end).toBeCloseTo(7); // 10 - 3
	});

	it('moves start when dragging left edge', () => {
		const drag = mkDrag('left');
		const result = computeFinalRange(drag, 160, zoom, duration); // -40px = -2s
		expect(result.start).toBeCloseTo(3); // 5 - 2
		expect(result.end).toBe(10);
	});

	it('clamps start to 0', () => {
		const drag = mkDrag('left');
		// Drag far left: -200px = -10s, so start would be 5 - 10 = -5
		const result = computeFinalRange(drag, 0, zoom, duration);
		expect(result.start).toBe(0);
	});

	it('clamps end to duration', () => {
		const drag = mkDrag('right', { originalRange: { start: 55, end: 59 } });
		// Drag far right: +200px = +10s, so end would be 59 + 10 = 69
		const result = computeFinalRange(drag, 400, zoom, duration);
		expect(result.end).toBe(60);
	});

	it('enforces 50ms minimum on left edge drag', () => {
		const drag = mkDrag('left');
		// Drag right far enough to make start >= end
		// start = 5 + 6 = 11, end = 10 → start > end → enforce min
		const result = computeFinalRange(drag, 320, zoom, duration); // +120px = +6s
		expect(result.end - result.start).toBeCloseTo(0.05);
		// Left edge: start = end - 0.05
		expect(result.start).toBeCloseTo(result.end - 0.05);
	});

	it('enforces 50ms minimum on right edge drag', () => {
		const drag = mkDrag('right');
		// Drag left far enough: -100px = -5s, end = 10 - 5 = 5, start = 5 → equal
		const result = computeFinalRange(drag, 100, zoom, duration);
		expect(result.end - result.start).toBeCloseTo(0.05);
		// Right edge: end = start + 0.05
		expect(result.end).toBeCloseTo(result.start + 0.05);
	});

	it('converts pixel delta to time delta correctly', () => {
		const drag = mkDrag('right');
		// +20px at zoom=20 → +1s
		const result = computeFinalRange(drag, 220, zoom, duration);
		expect(result.end).toBeCloseTo(11);
	});

	it('returns original range on zero movement', () => {
		const drag = mkDrag('right');
		const result = computeFinalRange(drag, 200, zoom, duration);
		expect(result.start).toBe(5);
		expect(result.end).toBe(10);
	});

	describe('move', () => {
		it('shifts both start and end by same delta', () => {
			const drag = mkDrag('move');
			const result = computeFinalRange(drag, 260, zoom, duration); // +60px = +3s
			expect(result.start).toBeCloseTo(8); // 5 + 3
			expect(result.end).toBeCloseTo(13); // 10 + 3
		});

		it('preserves duration when moving', () => {
			const drag = mkDrag('move');
			const result = computeFinalRange(drag, 260, zoom, duration);
			expect(result.end - result.start).toBeCloseTo(5); // original duration preserved
		});

		it('clamps to start=0 and preserves duration', () => {
			const drag = mkDrag('move');
			// -200px = -10s → start = 5-10 = -5 → clamp to 0, end = 5
			const result = computeFinalRange(drag, 0, zoom, duration);
			expect(result.start).toBe(0);
			expect(result.end).toBe(5); // duration preserved
		});

		it('clamps to end=duration and preserves duration', () => {
			const drag = mkDrag('move', { originalRange: { start: 55, end: 59 } });
			// +200px = +10s → end = 69 → clamp to 60, start = 56
			const result = computeFinalRange(drag, 400, zoom, duration);
			expect(result.end).toBe(60);
			expect(result.start).toBe(56); // 60 - 4 (original duration)
		});
	});
});

describe('validateResize', () => {
	const mkItem = (start: number, end: number) => ({ time_range: { start, end } });
	const segments = [mkItem(0, 5), mkItem(5, 10), mkItem(10, 15)];
	const duration = 60;

	it('returns true for a valid resize within bounds', () => {
		expect(validateResize({ start: 5, end: 9 }, 1, segments, duration)).toBe(true);
	});

	it('returns false when resize causes overlap with previous', () => {
		expect(validateResize({ start: 3, end: 10 }, 1, segments, duration)).toBe(false);
	});

	it('returns false when resize causes overlap with next', () => {
		expect(validateResize({ start: 5, end: 12 }, 1, segments, duration)).toBe(false);
	});

	it('returns false when range exceeds duration', () => {
		expect(validateResize({ start: 5, end: 65 }, 1, segments, duration)).toBe(false);
	});

	it('returns false when range has negative start', () => {
		expect(validateResize({ start: -1, end: 5 }, 0, segments, duration)).toBe(false);
	});

	it('returns false when range is below 50ms minimum', () => {
		expect(validateResize({ start: 5, end: 5.03 }, 1, segments, duration)).toBe(false);
	});

	it('returns true for exact boundary alignment (no overlap)', () => {
		// Resize index=1 to exactly touch neighbors
		expect(validateResize({ start: 5, end: 10 }, 1, segments, duration)).toBe(true);
	});

	describe('with edge parameter', () => {
		// Sparse items with gaps: [0,2) [5,8) [15,20)
		const sparse = [mkItem(0, 2), mkItem(5, 8), mkItem(15, 20)];

		it('uses neighbor check for left edge (default behavior)', () => {
			expect(validateResize({ start: 5, end: 8 }, 1, sparse, duration, 'left')).toBe(true);
		});

		it('uses neighbor check for right edge (default behavior)', () => {
			expect(validateResize({ start: 5, end: 8 }, 1, sparse, duration, 'right')).toBe(true);
		});

		it('uses full scan for move edge', () => {
			// Move index=1 from [5,8) to [16,19) — overlaps index=2 [15,20)
			expect(validateResize({ start: 16, end: 19 }, 1, sparse, duration, 'move')).toBe(false);
		});

		it('move to valid gap passes', () => {
			// Move index=1 from [5,8) to [9,12) — no overlap
			expect(validateResize({ start: 9, end: 12 }, 1, sparse, duration, 'move')).toBe(true);
		});

		it('move far past neighbors detects distant overlap', () => {
			// Move index=0 from [0,2) to [17,19) — neighbors at index 1 are [5,8)
			// Neighbor-only check would compare index -1 (none) and index 1 [5,8) → no overlap.
			// But the full scan catches that [17,19) overlaps index=2 [15,20).
			expect(validateResize({ start: 17, end: 19 }, 0, sparse, duration, 'move')).toBe(false);
		});
	});
});

describe('computeFinalRange edge cases', () => {
	it('at boundary time=0 (item already at start of timeline)', () => {
		const drag = mkDrag('left', { originalRange: { start: 0, end: 3 } });
		// Drag left by 20px = -1s, start would be -1 → clamped to 0
		const result = computeFinalRange(drag, 180, zoom, 60);
		expect(result.start).toBe(0);
	});

	it('at boundary time=duration (item already at end of timeline)', () => {
		const drag = mkDrag('right', { originalRange: { start: 57, end: 60 } });
		// Drag right by 40px = +2s, end would be 62 → clamped to 60
		const result = computeFinalRange(drag, 240, zoom, 60);
		expect(result.end).toBe(60);
	});

	it('move clamping to [0, duration] preserves original block duration', () => {
		const drag = mkDrag('move', { originalRange: { start: 1, end: 4 } });
		// Drag left by 60px = -3s → start=-2 → clamped to 0, end=3
		const result = computeFinalRange(drag, 140, zoom, 60);
		expect(result.start).toBe(0);
		expect(result.end).toBe(3); // 4 - 1 = 3s duration preserved
	});

	it('move right clamping preserves original block duration', () => {
		const drag = mkDrag('move', { originalRange: { start: 57, end: 59 } });
		// Drag right by 60px = +3s → end=62 → clamped to 60, start=58
		const result = computeFinalRange(drag, 260, zoom, 60);
		expect(result.end).toBe(60);
		expect(result.start).toBe(58); // 59 - 57 = 2s duration preserved
	});

	it('minimum duration enforcement on left edge at time 0', () => {
		const drag = mkDrag('left', { originalRange: { start: 0.02, end: 0.06 } });
		// Drag right far: +100px = +5s → start=5.02, end=0.06 → min enforced
		const result = computeFinalRange(drag, 300, zoom, 60);
		expect(result.end - result.start).toBeCloseTo(0.05);
	});
});
