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
