export class TimelineState {
  currentTime = $state(0);
  duration = $state(0);
  playing = $state(false);
  zoom = $state(4); // px per second
  scrollLeft = $state(0);
  containerWidth = $state(0);
  scrubbing = $state(false);

  private zoomInitialized = false;

  get viewStartTime(): number {
    return this.scrollLeft / this.zoom;
  }

  get viewEndTime(): number {
    return (this.scrollLeft + this.containerWidth) / this.zoom;
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
