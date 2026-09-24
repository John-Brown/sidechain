import { TrackLayoutState } from './tracks.svelte.js';

export class SessionState {
  videoId: string;
  videoSrc = $state('');
  filename = $state('');
  /** Project name for the header identity (null when unknown) */
  projectName = $state<string | null>(null);
  selectedAnnotation = $state<Record<string, unknown> | null>(null);

  // Track normalization toggle
  normalized = $state(false);

  // Picture-in-Picture
  pipActive = $state(false);
  pipSupported = $state(false);

  // Mesh overlay
  meshOverlayVisible = $state(false);
  meshOverlayOpacity = $state(0.7);
  meshVideoHidden = $state(false);

  /**
   * Timeline track layout: one config list (group, height, collapse, order)
   * for every track, persisted per user and mode. AnnotationViewer switches
   * its mode and user; the timeline renders `tracks.visibleTracks`.
   */
  readonly tracks: TrackLayoutState;

  constructor(videoId: string) {
    this.videoId = videoId;
    this.tracks = new TrackLayoutState();
    if (typeof document !== 'undefined') {
      this.pipSupported = document.pictureInPictureEnabled ?? false;
    }
  }
}
