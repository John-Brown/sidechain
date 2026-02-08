import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock idb-keyval before importing the module under test
const mockStore = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => mockStore.get(key) ?? undefined),
  set: vi.fn(async (key: string, value: unknown) => { mockStore.set(key, value); }),
  del: vi.fn(async (key: string) => { mockStore.delete(key); }),
}));

import {
  getWaveformFromCache,
  setWaveformInCache,
  clearWaveformFromCache,
  type CachedWaveform,
} from './waveform-cache.js';
import { get, set } from 'idb-keyval';

const makeCachedWaveform = (): CachedWaveform => ({
  peaksL: new Float32Array([0.1, 0.5, 0.9]),
  peaksR: null,
  sampleRate: 200,
  duration: 120,
  maxPeak: 0.9,
});

describe('waveform-cache', () => {
  beforeEach(() => {
    mockStore.clear();
    vi.clearAllMocks();
  });

  it('returns null on cache miss', async () => {
    const result = await getWaveformFromCache('missing-id');
    expect(result).toBeNull();
  });

  it('round-trips cached waveform data', async () => {
    const data = makeCachedWaveform();
    await setWaveformInCache('video-1', data);
    const result = await getWaveformFromCache('video-1');
    expect(result).not.toBeNull();
    expect(result!.peaksL).toEqual(data.peaksL);
    expect(result!.sampleRate).toBe(200);
    expect(result!.duration).toBe(120);
    expect(result!.maxPeak).toBe(0.9);
  });

  it('preserves Float32Array values', async () => {
    const data = makeCachedWaveform();
    await setWaveformInCache('video-2', data);
    const result = await getWaveformFromCache('video-2');
    expect(result!.peaksL[0]).toBeCloseTo(0.1);
    expect(result!.peaksL[2]).toBeCloseTo(0.9);
  });

  it('returns null on stereo peaksR when null', async () => {
    const data = makeCachedWaveform();
    await setWaveformInCache('video-3', data);
    const result = await getWaveformFromCache('video-3');
    expect(result!.peaksR).toBeNull();
  });

  it('returns null when idb-keyval throws', async () => {
    vi.mocked(get).mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    const result = await getWaveformFromCache('video-4');
    expect(result).toBeNull();
  });

  it('silently ignores set errors', async () => {
    vi.mocked(set).mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(setWaveformInCache('video-5', makeCachedWaveform())).resolves.toBeUndefined();
  });

  it('clears a cached waveform', async () => {
    await setWaveformInCache('video-6', makeCachedWaveform());
    await clearWaveformFromCache('video-6');
    const result = await getWaveformFromCache('video-6');
    expect(result).toBeNull();
  });
});
