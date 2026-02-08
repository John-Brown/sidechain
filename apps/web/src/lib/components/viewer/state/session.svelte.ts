export class SessionState {
  videoId: string;
  videoSrc = $state('');
  filename = $state('');
  selectedAnnotation = $state<Record<string, unknown> | null>(null);

  constructor(videoId: string) {
    this.videoId = videoId;
  }
}
