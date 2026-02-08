export function createTimelineState() {
  let currentTime = $state(0);
  let duration = $state(0);
  let playing = $state(false);
  let zoom = $state(4); // px per second
  let scrollLeft = $state(0);
  let containerWidth = $state(0);
  let scrubbing = $state(false);

  const viewStartTime = $derived(scrollLeft / zoom);
  const viewEndTime = $derived((scrollLeft + containerWidth) / zoom);

  function timeToPx(time: number): number {
    return time * zoom;
  }

  function pxToTime(px: number): number {
    return px / zoom;
  }

  return {
    get currentTime() { return currentTime; },
    set currentTime(v: number) { currentTime = v; },
    get duration() { return duration; },
    set duration(v: number) { duration = v; },
    get playing() { return playing; },
    set playing(v: boolean) { playing = v; },
    get zoom() { return zoom; },
    set zoom(v: number) { zoom = v; },
    get scrollLeft() { return scrollLeft; },
    set scrollLeft(v: number) { scrollLeft = v; },
    get containerWidth() { return containerWidth; },
    set containerWidth(v: number) { containerWidth = v; },
    get scrubbing() { return scrubbing; },
    set scrubbing(v: boolean) { scrubbing = v; },
    get viewStartTime() { return viewStartTime; },
    get viewEndTime() { return viewEndTime; },
    timeToPx,
    pxToTime,
  };
}

export type TimelineState = ReturnType<typeof createTimelineState>;
