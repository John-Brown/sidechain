export interface WaveformData {
  peaksL: Float32Array;
  peaksR: Float32Array | null; // null if mono
  sampleRate: number; // peaks per second
  duration: number;
}

const PEAKS_PER_SECOND = 200;

/**
 * Fetches audio from a video URL and extracts peak waveform data.
 * Uses Web Audio API to decode, then downsamples to ~200 peaks/sec.
 */
export async function extractWaveform(url: string): Promise<WaveformData> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  const audioCtx = new AudioContext();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const duration = audioBuffer.duration;
    const totalPeaks = Math.ceil(duration * PEAKS_PER_SECOND);
    const channelCount = audioBuffer.numberOfChannels;

    const peaksL = extractChannelPeaks(audioBuffer.getChannelData(0), totalPeaks);
    const peaksR = channelCount >= 2
      ? extractChannelPeaks(audioBuffer.getChannelData(1), totalPeaks)
      : null;

    return { peaksL, peaksR, sampleRate: PEAKS_PER_SECOND, duration };
  } finally {
    await audioCtx.close();
  }
}

function extractChannelPeaks(samples: Float32Array, totalPeaks: number): Float32Array {
  const peaks = new Float32Array(totalPeaks);
  const samplesPerPeak = samples.length / totalPeaks;

  for (let i = 0; i < totalPeaks; i++) {
    const start = Math.floor(i * samplesPerPeak);
    const end = Math.floor((i + 1) * samplesPerPeak);
    let max = 0;
    for (let j = start; j < end && j < samples.length; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }

  return peaks;
}
