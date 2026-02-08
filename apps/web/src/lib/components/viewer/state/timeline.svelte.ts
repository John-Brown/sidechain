export class TimelineState {
  currentTime = $state(0);
  duration = $state(0);
  playing = $state(false);
  zoom = $state(4); // px per second
  scrollLeft = $state(0);
  containerWidth = $state(0);
  scrubbing = $state(false);

  private zoomInitialized = false;

  /** Maximum valid scrollLeft for current zoom/duration/container */
  get maxScrollLeft(): number {
    return Math.max(0, this.duration * this.zoom - this.containerWidth);
  }

  /** scrollLeft clamped to valid range — use for viewport calculations */
  get clampedScrollLeft(): number {
    return Math.max(0, Math.min(this.scrollLeft, this.maxScrollLeft));
  }

  get viewStartTime(): number {
    return this.clampedScrollLeft / this.zoom;
  }

  get viewEndTime(): number {
    return (this.clampedScrollLeft + this.containerWidth) / this.zoom;
  }

  timeToPx(time: number): number {
    return time * this.zoom;
  }

  pxToTime(px: number): number {
    return px / this.zoom;
  }

  fitZoomToContainer() {
    if (this.zoomInitialized || this.containerWidth <= 0 || this.duration <= 0) return;
    const buffer = 40; // px breathing room on right
    this.zoom = (this.containerWidth - buffer) / this.duration;
    this.zoomInitialized = true;
  }
}
