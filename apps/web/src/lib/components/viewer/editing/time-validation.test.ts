import { describe, it } from 'vitest';

describe('time validation', () => {
	it.todo('detects overlapping annotations');
	it.todo('rejects annotation shorter than 50ms minimum duration');
	it.todo('rejects annotation with start < 0');
	it.todo('rejects annotation with end > duration');
	it.todo('enforces locked region boundaries in task mode');
	it.todo('validates contiguous coverage for state annotations');
});
