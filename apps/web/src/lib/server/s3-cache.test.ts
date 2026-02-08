import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCachedS3Getter } from './s3-cache.js';

describe('createCachedS3Getter', () => {
	let fetchCount: number;
	let fakeFetcher: <T>(key: string) => Promise<T>;

	beforeEach(() => {
		fetchCount = 0;
		fakeFetcher = vi.fn(async (key: string) => {
			fetchCount++;
			return { key, fetchIndex: fetchCount };
		}) as unknown as <T>(key: string) => Promise<T>;
	});

	it('calls fetcher on cache miss', async () => {
		const cached = createCachedS3Getter(fakeFetcher);
		const result = await cached.get<{ key: string }>('results/vid/vad.json');
		expect(result.key).toBe('results/vid/vad.json');
		expect(fetchCount).toBe(1);
	});

	it('returns cached value on cache hit without calling fetcher', async () => {
		const cached = createCachedS3Getter(fakeFetcher);
		await cached.get('key-1');
		const result = await cached.get<{ fetchIndex: number }>('key-1');
		expect(result.fetchIndex).toBe(1); // same data, not re-fetched
		expect(fetchCount).toBe(1);
	});

	it('re-fetches after TTL expires', async () => {
		const cached = createCachedS3Getter(fakeFetcher, 100); // 100ms TTL
		await cached.get('key-1');
		expect(fetchCount).toBe(1);

		// Wait for TTL to expire
		await new Promise((r) => setTimeout(r, 150));
		await cached.get('key-1');
		expect(fetchCount).toBe(2);
	});

	it('invalidate removes entry so next get re-fetches', async () => {
		const cached = createCachedS3Getter(fakeFetcher);
		await cached.get('key-1');
		expect(fetchCount).toBe(1);

		cached.invalidate('key-1');
		await cached.get('key-1');
		expect(fetchCount).toBe(2);
	});

	it('clear removes all entries', async () => {
		const cached = createCachedS3Getter(fakeFetcher);
		await cached.get('key-1');
		await cached.get('key-2');
		expect(cached.size()).toBe(2);

		cached.clear();
		expect(cached.size()).toBe(0);
	});

	it('deduplicates concurrent gets for the same key', async () => {
		let resolveFirst: ((v: unknown) => void) | null = null;
		const slowFetcher = vi.fn((key: string): Promise<unknown> => {
			fetchCount++;
			return new Promise((resolve) => {
				resolveFirst = resolve;
			});
		}) as unknown as <T>(key: string) => Promise<T>;

		const cached = createCachedS3Getter(slowFetcher);
		const p1 = cached.get('key-1');
		const p2 = cached.get('key-1');

		// Only one fetch should have started
		expect(fetchCount).toBe(1);

		resolveFirst!({ result: 'ok' });
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toEqual({ result: 'ok' });
		expect(r2).toEqual({ result: 'ok' });
	});

	it('propagates errors without caching them', async () => {
		const errorFetcher = vi.fn(async (): Promise<unknown> => {
			throw new Error('S3 error');
		}) as unknown as <T>(key: string) => Promise<T>;

		const cached = createCachedS3Getter(errorFetcher);
		await expect(cached.get('bad-key')).rejects.toThrow('S3 error');

		// Should retry on next call (error not cached)
		(errorFetcher as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
		const result = await cached.get('bad-key');
		expect(result).toEqual({ ok: true });
	});
});
