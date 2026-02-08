import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
	get: vi.fn(async (key: string) => mockStore.get(key) ?? undefined),
	set: vi.fn(async (key: string, value: unknown) => {
		mockStore.set(key, value);
	}),
	del: vi.fn(async (key: string) => {
		mockStore.delete(key);
	}),
	keys: vi.fn(async () => [...mockStore.keys()])
}));

import {
	getCachedAnnotation,
	setCachedAnnotation,
	clearAnnotationsForVideo
} from './annotation-cache.js';
import { get, set } from 'idb-keyval';

const sampleVadResult = {
	metadata: { source_file: 'test.mp4', format_version: '1.0' },
	segments: [{ time_range: { start: 0, end: 5 }, confidence: 0.95 }],
	frames: [{ time: 0, speech_probability: 0.8 }]
};

describe('annotation-cache', () => {
	beforeEach(() => {
		mockStore.clear();
		vi.clearAllMocks();
	});

	it('returns null on cache miss', async () => {
		const result = await getCachedAnnotation('vid-1', 'vad', '2025-01-01T00:00:00Z');
		expect(result).toBeNull();
	});

	it('round-trips annotation data', async () => {
		await setCachedAnnotation('vid-1', 'vad', '2025-01-01T00:00:00Z', sampleVadResult);
		const result = await getCachedAnnotation('vid-1', 'vad', '2025-01-01T00:00:00Z');
		expect(result).toEqual(sampleVadResult);
	});

	it('returns null when completedAt differs (version invalidation)', async () => {
		await setCachedAnnotation('vid-1', 'vad', '2025-01-01T00:00:00Z', sampleVadResult);
		const result = await getCachedAnnotation('vid-1', 'vad', '2025-01-02T00:00:00Z');
		expect(result).toBeNull();
	});

	it('separates different stages for same video', async () => {
		await setCachedAnnotation('vid-1', 'vad', 'ts1', { type: 'vad' });
		await setCachedAnnotation('vid-1', 'transcription', 'ts1', { type: 'transcription' });

		const vad = await getCachedAnnotation('vid-1', 'vad', 'ts1');
		const transcription = await getCachedAnnotation('vid-1', 'transcription', 'ts1');
		expect(vad).toEqual({ type: 'vad' });
		expect(transcription).toEqual({ type: 'transcription' });
	});

	it('returns null when idb-keyval get throws', async () => {
		vi.mocked(get).mockRejectedValueOnce(new Error('DB error'));
		const result = await getCachedAnnotation('vid-1', 'vad', 'ts1');
		expect(result).toBeNull();
	});

	it('silently ignores set errors', async () => {
		vi.mocked(set).mockRejectedValueOnce(new Error('Quota exceeded'));
		await expect(setCachedAnnotation('vid-1', 'vad', 'ts1', {})).resolves.toBeUndefined();
	});

	it('clearAnnotationsForVideo removes all entries for that video', async () => {
		await setCachedAnnotation('vid-1', 'vad', 'ts1', { a: 1 });
		await setCachedAnnotation('vid-1', 'transcription', 'ts1', { b: 2 });
		await setCachedAnnotation('vid-2', 'vad', 'ts1', { c: 3 });

		await clearAnnotationsForVideo('vid-1');

		expect(await getCachedAnnotation('vid-1', 'vad', 'ts1')).toBeNull();
		expect(await getCachedAnnotation('vid-1', 'transcription', 'ts1')).toBeNull();
		// vid-2 untouched
		expect(await getCachedAnnotation('vid-2', 'vad', 'ts1')).toEqual({ c: 3 });
	});
});
