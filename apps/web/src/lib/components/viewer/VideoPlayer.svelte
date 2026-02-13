<script lang="ts">
  import { onMount } from 'svelte';
  import { getTimelineState, getSessionState } from './context.js';
  import MeshOverlay from './components/MeshOverlay.svelte';

  interface Props {
    src: string;
  }

  let { src }: Props = $props();

  const timeline = getTimelineState();
  const session = getSessionState();

  let videoEl = $state<HTMLVideoElement>();

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

  // React to external seek (e.g., scrubbing on timeline)
  $effect(() => {
    if (timeline.scrubbing && videoEl) {
      videoEl.currentTime = timeline.currentTime;
    }
  });
</script>

<div class="w-full h-full flex items-center justify-center bg-black">
  <div class="relative inline-flex">
    <video
      bind:this={videoEl}
      {src}
      crossorigin="anonymous"
      tabindex="-1"
      class="max-w-full max-h-full block transition-opacity duration-150"
      style:opacity={session.meshVideoHidden ? 0.25 : 1}
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
  </div>
</div>
