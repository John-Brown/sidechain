import { describe, it, expect } from 'vitest';
import { History } from './history.svelte';

interface TestItem {
	time_range: { start: number; end: number };
	category: string;
}

const mkItem = (start: number, end: number, category = 'speaking'): TestItem => ({
	time_range: { start, end },
	category,
});

describe('History', () => {
	it('starts empty with no undo/redo available', () => {
		const history = new History<TestItem[]>();
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
		expect(history.undoCount).toBe(0);
		expect(history.redoCount).toBe(0);
	});

	it('push enables undo and clears redo', () => {
		const history = new History<TestItem[]>();
		history.push([mkItem(0, 5)]);
		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(false);
		expect(history.undoCount).toBe(1);
	});

	it('undo restores previous snapshot and enables redo', () => {
		const history = new History<TestItem[]>();
		const original = [mkItem(0, 5)];
		history.push(original);

		const current = [mkItem(0, 3), mkItem(3, 5)];
		const restored = history.undo(current);

		expect(restored).toEqual(original);
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(true);
	});

	it('redo restores the undone state', () => {
		const history = new History<TestItem[]>();
		const original = [mkItem(0, 5)];
		history.push(original);

		const afterEdit = [mkItem(0, 3), mkItem(3, 5)];
		history.undo(afterEdit);

		const redone = history.redo(original);
		expect(redone).toEqual(afterEdit);
		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(false);
	});

	it('undo on empty stack returns undefined', () => {
		const history = new History<TestItem[]>();
		expect(history.undo([mkItem(0, 5)])).toBeUndefined();
	});

	it('redo on empty stack returns undefined', () => {
		const history = new History<TestItem[]>();
		expect(history.redo([mkItem(0, 5)])).toBeUndefined();
	});

	it('redo with nothing undone returns undefined and keeps undo available', () => {
		const history = new History<TestItem[]>();
		history.push([mkItem(0, 5)]);
		expect(history.redo([mkItem(0, 10)])).toBeUndefined();
		expect(history.canUndo).toBe(true);
	});

	it('push clears redo stack', () => {
		const history = new History<TestItem[]>();
		history.push([mkItem(0, 5)]);
		history.undo([mkItem(0, 3), mkItem(3, 5)]);
		expect(history.canRedo).toBe(true);

		history.push([mkItem(0, 10)]);
		expect(history.canRedo).toBe(false);
	});

	it('push after multiple undos truncates the whole redo branch', () => {
		const history = new History<TestItem[]>();
		history.push([mkItem(0, 1)]);
		history.push([mkItem(0, 2)]);
		history.push([mkItem(0, 3)]);

		history.undo([mkItem(0, 4)]);
		history.undo([mkItem(0, 3)]);
		expect(history.redoCount).toBe(2);

		history.push([mkItem(0, 9)]);
		expect(history.canRedo).toBe(false);
		expect(history.redoCount).toBe(0);
		expect(history.canUndo).toBe(true);
	});

	it('respects maxSnapshots limit', () => {
		const history = new History<TestItem[]>(3);
		history.push([mkItem(0, 1)]);
		history.push([mkItem(0, 2)]);
		history.push([mkItem(0, 3)]);
		history.push([mkItem(0, 4)]); // oldest (end=1) should be dropped
		expect(history.undoCount).toBe(3);

		// Undo all three — should get 4, 3, 2 (not 1)
		const a = history.undo([mkItem(0, 99)]);
		const b = history.undo(a!);
		const c = history.undo(b!);
		expect(a![0].time_range.end).toBe(4);
		expect(b![0].time_range.end).toBe(3);
		expect(c![0].time_range.end).toBe(2);
		expect(history.undo(c!)).toBeUndefined();
	});

	it('uses default max of 50 snapshots', () => {
		const history = new History<TestItem[]>();
		for (let i = 0; i < 60; i++) {
			history.push([mkItem(0, i + 1)]);
		}
		expect(history.undoCount).toBe(50);
	});

	it('multiple undo/redo roundtrips return correct states', () => {
		const history = new History<TestItem[]>();
		history.push([mkItem(0, 1)]);
		history.push([mkItem(0, 2)]);
		history.push([mkItem(0, 3)]);

		const end = (s: TestItem[] | undefined) => s![0].time_range.end;

		// Undo all
		let current: TestItem[] = [mkItem(0, 100)];
		current = history.undo(current)!;
		expect(end(current)).toBe(3);
		current = history.undo(current)!;
		expect(end(current)).toBe(2);
		current = history.undo(current)!;
		expect(end(current)).toBe(1);
		expect(history.undo(current)).toBeUndefined();

		// Redo all
		current = history.redo(current)!;
		expect(end(current)).toBe(2);
		current = history.redo(current)!;
		expect(end(current)).toBe(3);
		current = history.redo(current)!;
		expect(end(current)).toBe(100);
		expect(history.redo(current)).toBeUndefined();
	});

	it('clear empties both stacks', () => {
		const history = new History<TestItem[]>();
		history.push([mkItem(0, 5)]);
		history.push([mkItem(0, 10)]);
		history.undo([mkItem(0, 3)]);
		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(true);

		history.clear();
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
		expect(history.undoCount).toBe(0);
		expect(history.redoCount).toBe(0);
	});

	it('deep clones snapshots so mutations do not affect history', () => {
		const history = new History<TestItem[]>();
		const items = [mkItem(0, 5)];
		history.push(items);

		// Mutate the original — should not affect the snapshot in history
		items[0].time_range.end = 99;

		const restored = history.undo([mkItem(0, 5)]);
		expect(restored![0].time_range.end).toBe(5);
	});

	it('undo/redo does not throw DataCloneError on proxy-like currentState', () => {
		// Svelte 5 $state wraps values in Proxy objects that are not structuredClone-able.
		// The $state.snapshot() call in undo/redo should unwrap before cloning.
		// In the test environment, .svelte.ts files compile $state to plain getters,
		// so we verify the call path works without throwing.
		const history = new History<TestItem[]>();
		const snapshot = [mkItem(0, 5, 'speaking'), mkItem(5, 10, 'listening')];
		history.push(snapshot);

		const currentState = [mkItem(0, 3, 'speaking'), mkItem(3, 10, 'listening')];

		// Should not throw
		expect(() => history.undo(currentState)).not.toThrow();
		expect(() => history.redo(snapshot)).not.toThrow();
	});
});
