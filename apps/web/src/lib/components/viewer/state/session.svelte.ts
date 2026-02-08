export class SessionState {
  videoId: string;
  videoSrc = $state('');
  filename = $state('');
  selectedAnnotation = $state<Record<string, unknown> | null>(null);

  // Waveform data
  waveformPeaksL = $state<Float32Array | null>(null);
  waveformPeaksR = $state<Float32Array | null>(null); // null if mono
  waveformSampleRate = $state(0); // peaks per second
  waveformLoading = $state(false);

  // Waveform normalization
  waveformMaxPeak = $state(1);

  // Track normalization toggle
  normalized = $state(false);

  // Picture-in-Picture
  pipActive = $state(false);
  pipSupported = $state(false);

  constructor(videoId: string) {
    this.videoId = videoId;
    if (typeof document !== 'undefined') {
      this.pipSupported = document.pictureInPictureEnabled ?? false;
    }
  }
}
