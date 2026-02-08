export function createSessionState(videoId: string) {
  let videoSrc = $state('');
  let filename = $state('');
  let selectedAnnotation = $state<Record<string, unknown> | null>(null);

  return {
    videoId,
    get videoSrc() { return videoSrc; },
    set videoSrc(v: string) { videoSrc = v; },
    get filename() { return filename; },
    set filename(v: string) { filename = v; },
    get selectedAnnotation() { return selectedAnnotation; },
    set selectedAnnotation(v: Record<string, unknown> | null) { selectedAnnotation = v; },
  };
}

export type SessionState = ReturnType<typeof createSessionState>;
