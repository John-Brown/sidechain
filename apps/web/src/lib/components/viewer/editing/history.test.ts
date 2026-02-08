import { describe, it } from 'vitest';

describe('createHistory', () => {
	it.todo('pushes initial state');
	it.todo('undo returns previous state');
	it.todo('redo returns next state');
	it.todo('undo at beginning returns undefined');
	it.todo('redo at end returns undefined');
	it.todo('overflow drops oldest entry when exceeding 50 snapshots');
	it.todo('new push after undo truncates redo branch');
});
