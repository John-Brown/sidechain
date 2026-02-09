export class SessionState {
  videoId: string;
  videoSrc = $state('');
  filename = $state('');
  selectedAnnotation = $state<Record<string, unknown> | null>(null);

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
