import { describe, it, expect } from 'vitest';
import {
	resizeAnnotation,
	deleteAnnotation,
	splitAnnotation,
	mergeAnnotations,
	createAnnotation,
	classifyAnnotation,
} from './operations';

interface TestAnnotation {
	time_range: { start: number; end: number };
	label: string;
}

const mkItem = (start: number, end: number, label: string): TestAnnotation => ({
	time_range: { start, end },
	label,
});

// Contiguous: [0,5) [5,10) [10,15)
const items: TestAnnotation[] = [
	mkItem(0, 5, 'a'),
	mkItem(5, 10, 'b'),
	mkItem(10, 15, 'c'),
];

describe('annotation operations', () => {
	describe('create', () => {
		it('inserts new annotation at correct sorted position', () => {
			const newItem = mkItem(7, 8, 'x');
			const result = createAnnotation(items, newItem);

			expect(result).toHaveLength(4);
			expect(result[2]).toEqual(newItem);
			// Items before and after remain in order
			expect(result[0].label).toBe('a');
			expect(result[1].label).toBe('b');
			expect(result[3].label).toBe('c');
		});

		it('inserts at beginning when start is before all items', () => {
			const result = createAnnotation(items, mkItem(-1, 0, 'z'));
			expect(result[0].label).toBe('z');
			expect(result).toHaveLength(4);
		});

		it('appends at end when start is after all items', () => {
			const result = createAnnotation(items, mkItem(20, 25, 'z'));
			expect(result[result.length - 1].label).toBe('z');
			expect(result).toHaveLength(4);
		});

		it('returns new array without mutating original', () => {
			const original = [...items];
			const result = createAnnotation(items, mkItem(7, 8, 'x'));
			expect(result).not.toBe(items);
			expect(items).toEqual(original);
		});

		it('handles empty array', () => {
			const result = createAnnotation([], mkItem(1, 2, 'x'));
			expect(result).toEqual([mkItem(1, 2, 'x')]);
		});
	});

	describe('delete', () => {
		it('removes annotation at index', () => {
			const result = deleteAnnotation(items, 1);
			expect(result).toHaveLength(2);
			expect(result[0].label).toBe('a');
			expect(result[1].label).toBe('c');
		});

		it('returns new array without mutating original', () => {
			const original = [...items];
			const result = deleteAnnotation(items, 0);
			expect(result).not.toBe(items);
			expect(items).toEqual(original);
		});

		it('removes first item', () => {
			const result = deleteAnnotation(items, 0);
			expect(result).toHaveLength(2);
			expect(result[0].label).toBe('b');
		});

		it('removes last item', () => {
			const result = deleteAnnotation(items, 2);
			expect(result).toHaveLength(2);
			expect(result[1].label).toBe('b');
		});
	});

	describe('resize', () => {
		it('updates time_range at given index', () => {
			const result = resizeAnnotation(items, 1, { start: 4, end: 11 });
			expect(result[1].time_range).toEqual({ start: 4, end: 11 });
			// Other fields preserved
			expect(result[1].label).toBe('b');
		});

		it('returns new array without mutating original', () => {
			const original = [...items];
			const origRange = { ...items[1].time_range };
			const result = resizeAnnotation(items, 1, { start: 4, end: 11 });
			expect(result).not.toBe(items);
			expect(items).toEqual(original);
			expect(items[1].time_range).toEqual(origRange);
		});
	});

	describe('split', () => {
		it('splits annotation into two at given time', () => {
			const result = splitAnnotation(items, 1, 7);
			expect(result).toHaveLength(4);
			expect(result[1].time_range).toEqual({ start: 5, end: 7 });
			expect(result[2].time_range).toEqual({ start: 7, end: 10 });
		});

		it('preserves total time range coverage', () => {
			const result = splitAnnotation(items, 1, 7);
			expect(result[1].time_range.start).toBe(items[1].time_range.start);
			expect(result[2].time_range.end).toBe(items[1].time_range.end);
		});

		it('preserves non-time fields on both halves', () => {
			const result = splitAnnotation(items, 1, 7);
			expect(result[1].label).toBe('b');
			expect(result[2].label).toBe('b');
		});

		it('returns new array without mutating original', () => {
			const original = [...items];
			const result = splitAnnotation(items, 1, 7);
			expect(result).not.toBe(items);
			expect(items).toEqual(original);
		});
	});

	describe('merge', () => {
		it('merges adjacent annotations', () => {
			const result = mergeAnnotations(items, 0, 1);
			expect(result).toHaveLength(2);
			expect(result[0].time_range).toEqual({ start: 0, end: 10 });
			expect(result[1].label).toBe('c');
		});

		it('combined time range spans both originals', () => {
			const result = mergeAnnotations(items, 1, 2);
			expect(result[1].time_range.start).toBe(items[1].time_range.start);
			expect(result[1].time_range.end).toBe(items[2].time_range.end);
		});

		it('preserves non-time fields from the lower-indexed item', () => {
			const result = mergeAnnotations(items, 0, 1);
			expect(result[0].label).toBe('a');
		});

		it('handles reversed index order', () => {
			const result = mergeAnnotations(items, 2, 0);
			// Should merge indices 0 through 2 into one
			expect(result).toHaveLength(1);
			expect(result[0].time_range).toEqual({ start: 0, end: 15 });
		});

		it('returns new array without mutating original', () => {
			const original = [...items];
			const result = mergeAnnotations(items, 0, 1);
			expect(result).not.toBe(items);
			expect(items).toEqual(original);
		});
	});

	describe('edge cases: empty arrays and out-of-bounds', () => {
		it('deleteAnnotation on empty array returns empty', () => {
			const result = deleteAnnotation([], 0);
			expect(result).toEqual([]);
		});

		it('resizeAnnotation on empty array produces item with new range', () => {
			// items[0] is undefined → structuredClone(undefined) → undefined
			// Spread of undefined is a no-op, so result is { time_range: newRange }
			const result = resizeAnnotation([] as { time_range: { start: number; end: number } }[], 0, { start: 1, end: 2 });
			expect(result).toHaveLength(1);
			expect(result[0].time_range).toEqual({ start: 1, end: 2 });
		});

		it('deleteAnnotation with out-of-bounds index returns same-length array', () => {
			// filter with i !== 99 removes nothing
			const result = deleteAnnotation(items, 99);
			expect(result).toHaveLength(3);
			expect(result).toEqual(items);
		});

		it('splitAnnotation at item start time produces zero-duration first half', () => {
			// Split at exactly the start of the item
			const result = splitAnnotation(items, 1, 5);
			expect(result).toHaveLength(4);
			expect(result[1].time_range).toEqual({ start: 5, end: 5 });
			expect(result[2].time_range).toEqual({ start: 5, end: 10 });
		});

		it('splitAnnotation at item end time produces zero-duration second half', () => {
			// Split at exactly the end of the item
			const result = splitAnnotation(items, 1, 10);
			expect(result).toHaveLength(4);
			expect(result[1].time_range).toEqual({ start: 5, end: 10 });
			expect(result[2].time_range).toEqual({ start: 10, end: 10 });
		});

		it('createAnnotation into empty array returns single-element array', () => {
			const result = createAnnotation([], mkItem(3, 5, 'x'));
			expect(result).toHaveLength(1);
			expect(result[0].label).toBe('x');
		});

		it('mergeAnnotations with same index produces single-element merge', () => {
			const result = mergeAnnotations(items, 1, 1);
			expect(result).toHaveLength(3);
			expect(result[1].time_range).toEqual({ start: 5, end: 10 });
		});

		it('classifyAnnotation preserves array length', () => {
			const result = classifyAnnotation(items, 0, { label: 'new' });
			expect(result).toHaveLength(items.length);
		});
	});

	describe('classify', () => {
		it('updates fields on annotation at index', () => {
			const result = classifyAnnotation(items, 1, { label: 'updated' });
			expect(result[1].label).toBe('updated');
			// time_range preserved
			expect(result[1].time_range).toEqual(items[1].time_range);
		});

		it('does not modify other items', () => {
			const result = classifyAnnotation(items, 1, { label: 'updated' });
			expect(result[0]).toEqual(items[0]);
			expect(result[2]).toEqual(items[2]);
		});

		it('returns new array without mutating original', () => {
			const original = [...items];
			const result = classifyAnnotation(items, 1, { label: 'updated' });
			expect(result).not.toBe(items);
			expect(items).toEqual(original);
			expect(items[1].label).toBe('b');
		});
	});
});
