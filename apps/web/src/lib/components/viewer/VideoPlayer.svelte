<script lang="ts">
  import { onMount } from 'svelte';
  import { Slider } from 'bits-ui';
  import { getTimelineState, getSessionState, getAnnotationDataState } from './context.js';
  import MeshOverlay from './components/MeshOverlay.svelte';

  interface Props {
    /** Video URL. Empty renders the stage placeholder; the <video> element stays mounted either way. */
    src: string;
  }

  let { src }: Props = $props();

  const timeline = getTimelineState();
  const session = getSessionState();
  const annotations = getAnnotationDataState();

  let videoEl = $state<HTMLVideoElement>();

  // Intrinsic size (from the element, else the facial-tracking metadata) and a measured frame rate.
  let videoWidth = $state(0);
  let videoHeight = $state(0);
  let fps = $state<number | null>(null);

  const meshAvailable = $derived(!!annotations.facialTracking?.metadata.mesh_topology);

  const resolution = $derived.by(() => {
    const w = videoWidth || annotations.facialTracking?.metadata.video_width || 0;
    const h = videoHeight || annotations.facialTracking?.metadata.video_height || 0;
    if (!w || !h) return '';
    return fps ? `${w}×${h} · ${fps} fps` : `${w}×${h}`;
  });

  const opacityPct = $derived(Math.round(session.meshOverlayOpacity * 100));

  // --- Frame-rate estimate from requestVideoFrameCallback (no $state writes per frame) ---

  const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
  let fpsSample: { frames: number; media: number } | null = null;

  function snapRate(raw: number): number {
    let best = COMMON_RATES[0];
    for (const r of COMMON_RATES) if (Math.abs(r - raw) < Math.abs(best - raw)) best = r;
    return Math.abs(best - raw) / best < 0.04 ? best : Math.round(raw * 100) / 100;
  }

  function sampleFps(meta: VideoFrameCallbackMetadata) {
    if (fps !== null || !videoEl || videoEl.paused || videoEl.playbackRate !== 1) {
      fpsSample = null;
      return;
    }
    if (!fpsSample) {
      fpsSample = { frames: meta.presentedFrames, media: meta.mediaTime };
      return;
    }
    const dt = meta.mediaTime - fpsSample.media;
    if (dt < 0) {
      fpsSample = null; // seeked backwards
    } else if (dt >= 1) {
      const frames = meta.presentedFrames - fpsSample.frames;
      if (frames > 0) fps = snapRate(frames / dt);
      fpsSample = null;
    }
  }

  // requestVideoFrameCallback for frame-accurate sync
  function onVideoFrame(_now: DOMHighResTimeStamp, meta: VideoFrameCallbackMetadata) {
    if (videoEl && src && !timeline.scrubbing) {
      timeline.currentTime = videoEl.currentTime;
    }
    sampleFps(meta);
    if (videoEl) {
      videoEl.requestVideoFrameCallback(onVideoFrame);
    }
  }

  onMount(() => {
    if (videoEl) {
      // Use RVFC if available, otherwise fall back to timeupdate
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        videoEl.requestVideoFrameCallback(onVideoFrame);
      }

      // PiP events (not in Svelte's type defs, attach imperatively)
      videoEl.addEventListener('enterpictureinpicture', handleEnterPip);
      videoEl.addEventListener('leavepictureinpicture', handleLeavePip);
    }

    return () => {
      if (videoEl) {
        videoEl.removeEventListener('enterpictureinpicture', handleEnterPip);
        videoEl.removeEventListener('leavepictureinpicture', handleLeavePip);
      }
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
      }
    };
  });

  function handleLoadedMetadata() {
    if (videoEl) {
      timeline.duration = videoEl.duration;
      videoWidth = videoEl.videoWidth;
      videoHeight = videoEl.videoHeight;
      fps = null;
    }
  }

  function handleTimeUpdate() {
    // Fallback for browsers without RVFC, and for paused state. Without a
    // source the element isn't the clock (Chrome still fires timeupdate at 0).
    if (videoEl && src && !timeline.scrubbing) {
      timeline.currentTime = videoEl.currentTime;
    }
  }

  function handlePlay() {
    timeline.playing = true;
  }

  function handlePause() {
    timeline.playing = false;
  }

  export function play() {
    videoEl?.play();
  }

  export function pause() {
    videoEl?.pause();
  }

  export function toggle() {
    if (videoEl?.paused) {
      videoEl.play();
    } else {
      videoEl?.pause();
    }
  }

  export function seek(time: number) {
    const t = Math.max(0, Math.min(time, timeline.duration));
    if (videoEl && src) {
      videoEl.currentTime = t;
      timeline.currentTime = videoEl.currentTime;
    } else {
      timeline.currentTime = t;
    }
  }

  export async function togglePip() {
    if (!videoEl) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoEl.requestPictureInPicture();
      }
    } catch {
      // PiP request can fail if user gesture requirement not met
    }
  }

  function handleEnterPip() {
    session.pipActive = true;
  }

  function handleLeavePip() {
    session.pipActive = false;
  }

  // --- Mesh bar controls (same semantics as the F / V shortcuts) ---

  function toggleMesh() {
    session.meshOverlayVisible = !session.meshOverlayVisible;
    if (!session.meshOverlayVisible) session.meshVideoHidden = false;
  }

  function toggleVideoHidden() {
    if (!session.meshOverlayVisible) return;
    session.meshVideoHidden = !session.meshVideoHidden;
  }

  // React to external seek (e.g., scrubbing on timeline)
  $effect(() => {
    if (timeline.scrubbing && videoEl) {
      videoEl.currentTime = timeline.currentTime;
    }
  });
</script>

<div class="w-full h-full min-h-0 flex flex-col">
  <!-- Stage: video and mesh share one box; object-contain letterboxes both identically -->
  <div class="stage flex-1 min-h-0 relative overflow-hidden">
    <video
      bind:this={videoEl}
      src={src || undefined}
      crossorigin="anonymous"
      tabindex="-1"
      class="absolute inset-0 w-full h-full object-contain block transition-opacity duration-150"
      style:opacity={session.meshVideoHidden ? 0 : 1}
      onloadedmetadata={handleLoadedMetadata}
      ontimeupdate={handleTimeUpdate}
      onplay={handlePlay}
      onpause={handlePause}
      onkeydown={(e) => e.preventDefault()}
    >
      <track kind="captions" />
    </video>
    {#if session.meshOverlayVisible && !session.pipActive && videoEl}
      <MeshOverlay {videoEl} />
    {/if}
    {#if session.pipActive}
      <span class="stage-note font-mono text-viewer-xs uppercase tracking-label">Playing in picture-in-picture</span>
    {:else if !src}
      <span class="stage-note font-mono text-viewer-xs uppercase tracking-label">No video</span>
    {/if}
  </div>

  <!-- 32px mesh bar -->
  <div
    class="h-8 flex-none flex items-center gap-3.5 px-2.5 bg-viewer-surface-2 border-t border-viewer-border font-mono text-viewer-xs uppercase text-viewer-text-dim bar"
  >
    <button
      type="button"
      class="ctl"
      aria-pressed={session.meshOverlayVisible}
      disabled={!meshAvailable}
      title={meshAvailable ? 'Face mesh overlay (F)' : 'No face mesh for this video'}
      onclick={toggleMesh}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><path d="M9 9h.01M15 9h.01"></path></svg>
      Mesh <span class="text-viewer-text-subtle" aria-hidden="true">F</span>
    </button>

    <span class="flex items-center gap-2" class:opacity-50={!session.meshOverlayVisible}>
      <span id="mesh-opacity-label">Opacity</span>
      <Slider.Root
        type="single"
        bind:value={() => opacityPct, (v) => (session.meshOverlayOpacity = v / 100)}
        min={0}
        max={100}
        step={5}
        disabled={!session.meshOverlayVisible}
        aria-labelledby="mesh-opacity-label"
        class="relative flex items-center w-[72px] h-2.5 touch-none select-none"
      >
        <span class="slider-track absolute inset-x-0 top-1 h-0.5"></span>
        <Slider.Range class="slider-range top-1 h-0.5" />
        <Slider.Thumb index={0} class="slider-thumb top-0 block size-2.5 rounded-sm" aria-label="Mesh opacity" />
      </Slider.Root>
      <span class="w-8 text-viewer-text">{opacityPct}%</span>
    </span>

    <button
      type="button"
      class="ctl"
      aria-pressed={session.meshVideoHidden}
      disabled={!session.meshOverlayVisible}
      title={session.meshOverlayVisible ? 'Hide video, show only the mesh (V)' : 'Turn on the mesh first'}
      onclick={toggleVideoHidden}
    >
      {#if session.meshVideoHidden}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"></path><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"></path><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"></path><path d="m2 2 20 20"></path></svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle></svg>
      {/if}
      Hide video <span class="text-viewer-text-subtle" aria-hidden="true">V</span>
    </button>

    <div class="flex-1"></div>
    {#if resolution}
      <span class="normal-case tracking-normal text-viewer-text-subtle">{resolution}</span>
    {/if}
  </div>
</div>

<style>
  /* Fixed near-black letterbox in both themes (design: #13100d), so footage reads the same Day and Night. */
  .stage {
    background: #13100d;
  }

  .stage-note {
    position: absolute;
    left: 12px;
    bottom: 10px;
    color: #7f7264;
  }

  .bar {
    letter-spacing: 0.08em;
  }

  .ctl {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 2px;
    text-transform: inherit;
    letter-spacing: inherit;
    border-radius: 2px;
    transition: color 150ms;
  }

  .ctl:not(:disabled):hover {
    color: var(--viewer-text);
  }

  .ctl[aria-pressed='true'] {
    color: var(--viewer-accent);
  }

  .ctl:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .bar :global(.slider-track) {
    background: var(--viewer-border);
  }

  .bar :global(.slider-range) {
    background: var(--viewer-accent);
  }

  .bar :global(.slider-thumb) {
    background: var(--viewer-accent);
    cursor: grab;
    transition: background-color 150ms;
  }

  .bar :global(.slider-thumb:hover) {
    background: var(--viewer-accent-hover);
  }

  .bar :global(.slider-thumb:focus-visible) {
    outline: 2px solid var(--viewer-accent);
    outline-offset: 2px;
  }

  .bar :global([data-disabled] .slider-thumb),
  .bar :global(.slider-thumb[data-disabled]) {
    cursor: not-allowed;
  }
</style>
