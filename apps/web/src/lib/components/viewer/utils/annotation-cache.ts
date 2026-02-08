import { get, set, del, keys } from 'idb-keyval';

const cacheKey = (videoId: string, stage: string, completedAt: string) =>
	`ann:${videoId}:${stage}:${completedAt}`;

export async function getCachedAnnotation<T = unknown>(
	videoId: string,
	stage: string,
	completedAt: string
): Promise<T | null> {
	try {
		return (await get<T>(cacheKey(videoId, stage, completedAt))) ?? null;
	} catch {
		return null;
	}
}

export async function setCachedAnnotation(
	videoId: string,
	stage: string,
	completedAt: string,
	data: unknown
): Promise<void> {
	try {
		await set(cacheKey(videoId, stage, completedAt), data);
	} catch {
		// Cache is optional — silent fail
	}
}

export async function clearAnnotationsForVideo(videoId: string): Promise<void> {
	try {
		const allKeys = await keys();
		const prefix = `ann:${videoId}:`;
		for (const k of allKeys) {
			if (typeof k === 'string' && k.startsWith(prefix)) {
				await del(k);
			}
		}
	} catch {
		// silent
	}
}
