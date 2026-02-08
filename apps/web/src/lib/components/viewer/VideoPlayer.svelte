<script lang="ts">
  import { onMount } from 'svelte';
  import { getTimelineState } from './context.js';

  interface Props {
    src: string;
  }

  let { src }: Props = $props();

  const timeline = getTimelineState();

  let videoEl: HTMLVideoElement;

  // requestVideoFrameCallback for frame-accurate sync
  function onVideoFrame() {
    if (videoEl && !timeline.scrubbing) {
      timeline.currentTime = videoEl.currentTime;
    }
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
    }
  });

  function handleLoadedMetadata() {
    if (videoEl) {
      timeline.duration = videoEl.duration;
    }
  }

  function handleTimeUpdate() {
    // Fallback for browsers without RVFC, and for paused state
    if (videoEl && !timeline.scrubbing) {
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
    if (videoEl) {
      videoEl.currentTime = Math.max(0, Math.min(time, timeline.duration));
      timeline.currentTime = videoEl.currentTime;
    }
  }

  // React to external seek (e.g., scrubbing on timeline)
  $effect(() => {
    if (timeline.scrubbing && videoEl) {
      videoEl.currentTime = timeline.currentTime;
    }
  });
</script>

<div class="w-full h-full flex items-center justify-center bg-black">
  <video
    bind:this={videoEl}
    {src}
    crossorigin="anonymous"
    class="max-w-full max-h-full"
    onloadedmetadata={handleLoadedMetadata}
    ontimeupdate={handleTimeUpdate}
    onplay={handlePlay}
    onpause={handlePause}
  >
    <track kind="captions" />
  </video>
</div>
