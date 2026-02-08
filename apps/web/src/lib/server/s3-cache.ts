/**
 * In-memory cache with TTL for S3 object fetches.
 * Factory pattern — accepts a fetcher function for testability.
 */
export function createCachedS3Getter(
	fetcher: <T>(key: string) => Promise<T>,
	ttlMs: number = 30 * 60 * 1000
) {
	const cache = new Map<string, { data: unknown; expiresAt: number }>();
	const inflight = new Map<string, Promise<unknown>>();

	async function get<T = unknown>(key: string): Promise<T> {
		const entry = cache.get(key);
		if (entry && Date.now() < entry.expiresAt) {
			return entry.data as T;
		}

		// Deduplicate concurrent requests for the same key
		const existing = inflight.get(key);
		if (existing) return existing as Promise<T>;

		const promise = fetcher<T>(key)
			.then((data) => {
				cache.set(key, { data, expiresAt: Date.now() + ttlMs });
				inflight.delete(key);
				return data;
			})
			.catch((err) => {
				inflight.delete(key);
				throw err;
			});

		inflight.set(key, promise);
		return promise;
	}

	function invalidate(key: string) {
		cache.delete(key);
		inflight.delete(key);
	}

	function clear() {
		cache.clear();
		inflight.clear();
	}

	function size() {
		return cache.size;
	}

	return { get, invalidate, clear, size };
}
