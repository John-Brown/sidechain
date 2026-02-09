import { describe, it, expect } from 'vitest';
import { History } from '../state/history.svelte';

describe('History', () => {
	it('pushes initial state', () => {
		const h = new History<number[]>();
		h.push([1, 2, 3]);

		expect(h.canUndo).toBe(true);
		expect(h.undoCount).toBe(1);
		expect(h.canRedo).toBe(false);
	});

	it('undo returns previous state', () => {
		const h = new History<number[]>();
		h.push([1, 2, 3]);

		const restored = h.undo([4, 5, 6]);
		expect(restored).toEqual([1, 2, 3]);
		expect(h.canUndo).toBe(false);
		expect(h.canRedo).toBe(true);
	});

	it('redo returns next state', () => {
		const h = new History<number[]>();
		h.push([1, 2, 3]);
		h.undo([4, 5, 6]);

		const redone = h.redo([1, 2, 3]);
		expect(redone).toEqual([4, 5, 6]);
		expect(h.canUndo).toBe(true);
		expect(h.canRedo).toBe(false);
	});

	it('undo at beginning returns undefined', () => {
		const h = new History<string>();
		expect(h.undo('current')).toBeUndefined();
		expect(h.canRedo).toBe(false);
	});

	it('redo at end returns undefined', () => {
		const h = new History<string>();
		h.push('a');
		expect(h.redo('current')).toBeUndefined();
		expect(h.canUndo).toBe(true);
	});

	it('overflow drops oldest entry when exceeding max snapshots', () => {
		const h = new History<number>(3);
		h.push(1);
		h.push(2);
		h.push(3);
		h.push(4); // oldest (1) should be dropped

		expect(h.undoCount).toBe(3);

		// Undo all three — should get 4, 3, 2 (not 1)
		const a = h.undo(99);
		const b = h.undo(a!);
		const c = h.undo(b!);
		expect(a).toBe(4);
		expect(b).toBe(3);
		expect(c).toBe(2);
		expect(h.undo(c!)).toBeUndefined();
	});

	it('new push after undo truncates redo branch', () => {
		const h = new History<string>();
		h.push('a');
		h.push('b');
		h.push('c');

		h.undo('current'); // undo c -> redo has 'current'
		h.undo('b');       // undo b -> redo has 'b', 'current'

		// Now push a new state — redo branch should be cleared
		h.push('d');

		expect(h.canRedo).toBe(false);
		expect(h.redoCount).toBe(0);
		expect(h.canUndo).toBe(true);
	});

	it('clear resets both stacks', () => {
		const h = new History<number>();
		h.push(1);
		h.push(2);
		h.undo(3);

		expect(h.canUndo).toBe(true);
		expect(h.canRedo).toBe(true);

		h.clear();

		expect(h.canUndo).toBe(false);
		expect(h.canRedo).toBe(false);
		expect(h.undoCount).toBe(0);
		expect(h.redoCount).toBe(0);
	});

	it('deep-clones snapshots so mutations do not affect stored state', () => {
		const h = new History<{ items: number[] }>();
		const original = { items: [1, 2, 3] };
		h.push(original);

		// Mutating the original object should not affect the snapshot
		original.items.push(4);

		const restored = h.undo({ items: [] });
		expect(restored).toEqual({ items: [1, 2, 3] });
	});

	it('multiple undo/redo roundtrips return correct states', () => {
		const h = new History<string>();
		h.push('a');
		h.push('b');
		h.push('c');

		// Undo all
		let current = 'live';
		current = h.undo(current)!; // -> c
		expect(current).toBe('c');
		current = h.undo(current)!; // -> b
		expect(current).toBe('b');
		current = h.undo(current)!; // -> a
		expect(current).toBe('a');
		expect(h.undo(current)).toBeUndefined();

		// Redo all
		current = h.redo(current)!; // -> b
		expect(current).toBe('b');
		current = h.redo(current)!; // -> c
		expect(current).toBe('c');
		current = h.redo(current)!; // -> live
		expect(current).toBe('live');
		expect(h.redo(current)).toBeUndefined();
	});

	it('uses default max of 50 snapshots', () => {
		const h = new History<number>();
		for (let i = 0; i < 60; i++) {
			h.push(i);
		}
		expect(h.undoCount).toBe(50);
	});
});
