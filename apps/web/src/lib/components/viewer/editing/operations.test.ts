import { describe, it } from 'vitest';

describe('annotation operations', () => {
	describe('create', () => {
		it.todo('inserts new annotation at correct position');
		it.todo('returns new array without mutating original');
	});
	describe('delete', () => {
		it.todo('removes annotation at index');
		it.todo('returns new array without mutating original');
	});
	describe('split', () => {
		it.todo('splits annotation into two at given time');
		it.todo('preserves total time range coverage');
	});
	describe('merge', () => {
		it.todo('merges adjacent annotations');
		it.todo('combined time range spans both originals');
	});
	describe('classify', () => {
		it.todo('updates category/type on annotation');
		it.todo('returns new array without mutating original');
	});
});
