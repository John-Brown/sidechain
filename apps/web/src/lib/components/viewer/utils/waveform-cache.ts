import { get, set, del } from 'idb-keyval';

export interface CachedWaveform {
  peaksL: Float32Array;
  peaksR: Float32Array | null;
  sampleRate: number;
  duration: number;
  maxPeak: number;
}

const cacheKey = (videoId: string) => `waveform:${videoId}`;

export async function getWaveformFromCache(videoId: string): Promise<CachedWaveform | null> {
  try {
    return (await get<CachedWaveform>(cacheKey(videoId))) ?? null;
  } catch {
    return null;
  }
}

export async function setWaveformInCache(videoId: string, data: CachedWaveform): Promise<void> {
  try {
    await set(cacheKey(videoId), data);
  } catch {
    // Cache is optional — silent fail
  }
}

export async function clearWaveformFromCache(videoId: string): Promise<void> {
  try {
    await del(cacheKey(videoId));
  } catch {
    // silent
  }
}
