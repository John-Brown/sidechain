<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { DiarizationSegment, IntentAnnotation, SpeechWord, TimeRange } from '@annotation/shared';
  import { getTimelineState } from '../context.js';
  import { isLowConfidence } from '../review.js';
  import type { ViewerPalette } from '../viewer-palette.js';

  /**
   * Whole-video navigator (30px canvas under the tracks). Draws two speaker
   * lanes, low-confidence ticks, locked ranges (ink hatch), the current
   * window (accent outline + wash) and the playhead. Every color comes from
   * the ViewerPalette.
   *
   * Cheap by construction: the data layer (lanes, ticks, hatch) is rendered
   * once into an offscreen canvas whenever data, palette or size change; each
   * scroll / playback frame only blits it and draws the window + playhead.
   *
   * Pointer: drag the window to scroll (onScrollTo(windowStartTime)); click
   * anywhere to seek (onSeek). Dragging outside the window scrubs.
   * Keyboard (role=slider on the window position): ←/→ pan by 10% of the
   * window, ⇧←/→ by a full window, Home/End jump to the ends.
   */
  interface Props {
    palette: ViewerPalette;
    /** Speaker lanes come from diarization turns when present, else from words */
    diarization?: readonly DiarizationSegment[] | null;
    words?: readonly SpeechWord[] | null;
    /** Low-confidence ticks: intents and words below LOW_CONFIDENCE that no human decided on */
    intents?: readonly IntentAnnotation[] | null;
    lockedRanges?: readonly TimeRange[];
    /** Scroll the timeline so the window starts at `time` (seconds) */
    onScrollTo?: (time: number) => void;
    onSeek?: (time: number) => void;
    height?: number;
    /** Width of the "Overview" label cell in px; 0 hides it */
    labelWidth?: number;
  }

  let {
    palette,
    diarization = null,
    words = null,
    intents = null,
    lockedRanges = [],
    onScrollTo,
    onSeek,
    height = 30,
    labelWidth = 184,
  }: Props = $props();

  // Geometry (design: lanes at y 9 and 16, ticks at y 23, all 5px tall; window inset 2px)
  const LANE_H = 5;
  const LANE_Y = [9, 16] as const;
  const TICK_Y = 23;
  const TICK_W = 1.5;
  const WINDOW_INSET = 2;
  const MIN_WINDOW_W = 4;
  /** Spans closer than this (px) merge into one run */
  const MERGE_GAP_PX = 1;
  /** Lock hatch: 135°, 3px on / 5px off (period 8px perpendicular to the stripes) */
  const HATCH_W = 3;
  const HATCH_PERIOD = 8 * Math.SQRT2;
  const DRAG_THRESHOLD = 3;

  const timeline = getTimelineState();

  let canvasEl: HTMLCanvasElement;
  let containerEl: HTMLDivElement;
  let width = $state(0);
  let dpr = $state(1);
  let layer: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;

  interface Span {
    start: number;
    end: number;
    lane: 0 | 1;
  }

  function laneOf(speaker: string): 0 | 1 {
    return speaker === 'SPEAKER_00' ? 0 : 1;
  }

  /** Speaker spans in time order (diarization turns, or words as a fallback) */
  const spans = $derived.by((): Span[] => {
    if (diarization && diarization.length > 0) {
      return diarization.map((d) => ({
        start: d.time_range.start,
        end: d.time_range.end,
        lane: laneOf(d.diarization.speaker),
      }));
    }
    if (words && words.length > 0) {
      return words.map((w) => ({
        start: w.time_range.start,
        end: w.time_range.end,
        lane: laneOf(w.speech.speaker),
      }));
    }
    return [];
  });

  /** Start times of low-confidence items, sorted */
  const lowConfTimes = $derived.by((): number[] => {
    const times: number[] = [];
    if (intents) for (const i of intents) if (isLowConfidence(i)) times.push(i.time_range.start);
    if (words) for (const w of words) if (isLowConfidence(w)) times.push(w.time_range.start);
    return times.sort((a, b) => a - b);
  });

  function scale(): number {
    return timeline.duration > 0 ? width / timeline.duration : 0;
  }

  // --- Data layer (offscreen) ---
  function renderLayer() {
    const w = width;
    const h = height;
    const s = scale();
    if (!layer) layer = document.createElement('canvas');
    layer.width = Math.max(1, Math.ceil(w * dpr));
    layer.height = Math.max(1, Math.ceil(h * dpr));
    const lc = layer.getContext('2d');
    if (!lc) return;
    lc.setTransform(dpr, 0, 0, dpr, 0, 0);
    lc.clearRect(0, 0, w, h);
    if (s <= 0 || w <= 0) return;

    // Speaker lanes: merge runs that are within a pixel of each other, per lane
    const laneColor = [palette.waveformL, palette.waveformR];
    for (const lane of [0, 1] as const) {
      lc.fillStyle = laneColor[lane];
      let runStart = -1;
      let runEnd = -1;
      for (const sp of spans) {
        if (sp.lane !== lane) continue;
        const x0 = sp.start * s;
        const x1 = sp.end * s;
        if (runStart < 0) {
          runStart = x0;
          runEnd = x1;
        } else if (x0 - runEnd <= MERGE_GAP_PX) {
          if (x1 > runEnd) runEnd = x1;
        } else {
          lc.fillRect(runStart, LANE_Y[lane], Math.max(runEnd - runStart, 1), LANE_H);
          runStart = x0;
          runEnd = x1;
        }
      }
      if (runStart >= 0) lc.fillRect(runStart, LANE_Y[lane], Math.max(runEnd - runStart, 1), LANE_H);
    }

    // Low-confidence ticks (one per pixel column at most)
    lc.fillStyle = palette.lowConfMarker;
    let lastX = -Infinity;
    for (const t of lowConfTimes) {
      const x = Math.round(t * s * 2) / 2;
      if (x - lastX < TICK_W) continue;
      lc.fillRect(x, TICK_Y, TICK_W, LANE_H);
      lastX = x;
    }

    // Locked ranges: diagonal ink hatch clipped to each range
    if (lockedRanges.length > 0) {
      lc.strokeStyle = palette.lockHatch;
      lc.lineWidth = HATCH_W;
      for (const r of lockedRanges) {
        const x0 = r.start * s;
        const rw = Math.max((r.end - r.start) * s, 2);
        lc.save();
        lc.beginPath();
        lc.rect(x0, 0, rw, h);
        lc.clip();
        lc.beginPath();
        for (let a = x0 - h; a < x0 + rw + h; a += HATCH_PERIOD) {
          lc.moveTo(a, h);
          lc.lineTo(a + h, 0);
        }
        lc.stroke();
        lc.restore();
      }
    }
  }

  // --- Per-frame composite: data layer + window + playhead ---
  function composite() {
    if (!canvasEl || !ctx) return;
    const w = width;
    const h = height;
    const bw = Math.max(1, Math.ceil(w * dpr));
    const bh = Math.max(1, Math.ceil(h * dpr));
    if (canvasEl.width !== bw || canvasEl.height !== bh) {
      canvasEl.width = bw;
      canvasEl.height = bh;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    if (layer) ctx.drawImage(layer, 0, 0);

    const s = scale();
    if (s <= 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Current window
    const wx = timeline.viewStartTime * s;
    const ww = Math.max((timeline.viewEndTime - timeline.viewStartTime) * s, MIN_WINDOW_W);
    const wh = h - WINDOW_INSET * 2;
    ctx.fillStyle = palette.overviewWindowBg;
    ctx.fillRect(wx, WINDOW_INSET, ww, wh);
    ctx.strokeStyle = palette.overviewWindow;
    ctx.lineWidth = 1;
    ctx.strokeRect(wx + 0.5, WINDOW_INSET + 0.5, Math.max(ww - 1, 1), wh - 1);

    // Playhead
    ctx.fillStyle = palette.playhead;
    ctx.fillRect(Math.round(timeline.currentTime * s), 0, 1, h);
  }

  // Data layer: re-render on data / palette / size / locked-range changes only
  $effect(() => {
    spans;
    lowConfTimes;
    lockedRanges;
    palette;
    width;
    height;
    dpr;
    timeline.duration;
    renderLayer();
    untrack(composite);
  });

  // Window + playhead: cheap redraw on scroll, zoom, resize and playback
  $effect(() => {
    timeline.viewStartTime;
    timeline.viewEndTime;
    timeline.currentTime;
    composite();
  });

  onMount(() => {
    ctx = canvasEl.getContext('2d');
    dpr = window.devicePixelRatio || 1;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) width = entry.contentRect.width;
      dpr = window.devicePixelRatio || 1;
    });
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  // --- Pointer interaction (no reactive writes of our own; callbacks only) ---
  let pointerMode: 'window' | 'seek' | null = null;
  let grabOffset = 0;
  let downX = 0;
  let moved = false;
  let moveRaf = 0;

  function xToTime(clientX: number): number {
    const rect = containerEl.getBoundingClientRect();
    const s = scale();
    if (s <= 0) return 0;
    return Math.max(0, Math.min((clientX - rect.left) / s, timeline.duration));
  }

  function windowDuration(): number {
    return timeline.viewEndTime - timeline.viewStartTime;
  }

  function isOverWindow(clientX: number): boolean {
    const rect = containerEl.getBoundingClientRect();
    const s = scale();
    const x = clientX - rect.left;
    const wx = timeline.viewStartTime * s;
    const ww = Math.max(windowDuration() * s, MIN_WINDOW_W);
    return x >= wx - 2 && x <= wx + ww + 2;
  }

  function scrollTo(start: number) {
    const maxStart = Math.max(0, timeline.duration - windowDuration());
    onScrollTo?.(Math.max(0, Math.min(start, maxStart)));
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0 || timeline.duration <= 0) return;
    e.preventDefault();
    canvasEl.setPointerCapture(e.pointerId);
    downX = e.clientX;
    moved = false;
    if (isOverWindow(e.clientX)) {
      pointerMode = 'window';
      grabOffset = xToTime(e.clientX) - timeline.viewStartTime;
      canvasEl.style.cursor = 'grabbing';
    } else {
      pointerMode = 'seek';
      onSeek?.(xToTime(e.clientX));
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (!pointerMode) {
      canvasEl.style.cursor = isOverWindow(e.clientX) ? 'grab' : 'pointer';
      return;
    }
    if (!moved && Math.abs(e.clientX - downX) < DRAG_THRESHOLD) return;
    moved = true;
    const clientX = e.clientX;
    const mode = pointerMode;
    cancelAnimationFrame(moveRaf);
    moveRaf = requestAnimationFrame(() => {
      if (mode === 'window') scrollTo(xToTime(clientX) - grabOffset);
      else onSeek?.(xToTime(clientX));
    });
  }

  function handlePointerUp(e: PointerEvent) {
    if (!pointerMode) return;
    cancelAnimationFrame(moveRaf);
    if (canvasEl.hasPointerCapture(e.pointerId)) canvasEl.releasePointerCapture(e.pointerId);
    // A click (no drag) on the window seeks, like anywhere else
    if (pointerMode === 'window' && !moved) onSeek?.(xToTime(e.clientX));
    pointerMode = null;
    canvasEl.style.cursor = isOverWindow(e.clientX) ? 'grab' : 'pointer';
  }

  function handlePointerCancel(e: PointerEvent) {
    cancelAnimationFrame(moveRaf);
    if (canvasEl.hasPointerCapture(e.pointerId)) canvasEl.releasePointerCapture(e.pointerId);
    pointerMode = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const win = windowDuration();
    let start: number | null = null;
    if (e.key === 'ArrowLeft') start = timeline.viewStartTime - (e.shiftKey ? win : win * 0.1);
    else if (e.key === 'ArrowRight') start = timeline.viewStartTime + (e.shiftKey ? win : win * 0.1);
    else if (e.key === 'Home') start = 0;
    else if (e.key === 'End') start = timeline.duration;
    if (start == null) return;
    e.preventDefault();
    e.stopPropagation();
    scrollTo(start);
  }

  function fmt(t: number): string {
    const m = Math.floor(t / 60);
    const s = Math.floor(t - m * 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

</script>

<div class="flex shrink-0 border-t border-viewer-border bg-viewer-bg" style="height: {height}px">
  {#if labelWidth > 0}
    <div
      class="flex items-center px-2.5 border-r border-viewer-border font-mono text-viewer-xs uppercase tracking-label text-viewer-text-subtle select-none"
      style="width: {labelWidth}px; flex: none;"
    >
      Overview
    </div>
  {/if}
  <div bind:this={containerEl} class="relative flex-1 min-w-0 overflow-hidden">
    <canvas
      bind:this={canvasEl}
      class="overview-canvas absolute top-0 left-0"
      style="width: {width}px; height: {height}px"
      role="slider"
      tabindex="0"
      aria-label="Timeline overview"
      aria-valuemin={0}
      aria-valuemax={Math.round(timeline.duration)}
      aria-valuenow={Math.round(timeline.viewStartTime)}
      aria-valuetext="Window {fmt(timeline.viewStartTime)} – {fmt(timeline.viewEndTime)}"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerCancel}
      onkeydown={handleKeydown}
    ></canvas>
  </div>
</div>

<style>
  .overview-canvas {
    cursor: pointer;
    touch-action: none;
  }
</style>
