<script lang="ts">
  import { onMount } from 'svelte';
  import { createSupabaseBrowserClient } from '$lib/supabase';
  import { createTRPCClientInstance } from '$lib/trpc';
  import type {
    VadResult,
    TranscriptionResult,
    DiarizationResult,
    FacialTrackingResult,
    MouthEnergyResult,
    StateAnnotationResult,
    IntentClassificationResult,
    SpeechWord,
  } from '@annotation/shared';
  import type { Viewport } from './types.js';

  import { TimelineState } from './state/timeline.svelte.js';
  import { AnnotationDataState } from './state/annotation-data.svelte.js';
  import { SessionState } from './state/session.svelte.js';
  import {
    setTimelineState,
    setAnnotationDataState,
    setSessionState,
  } from './context.js';

  import ViewerHeader from './ViewerHeader.svelte';
  import VideoPlayer from './VideoPlayer.svelte';
  import InspectorPanel from './InspectorPanel.svelte';
  import Playhead from './Playhead.svelte';
  import CanvasTrack from './tracks/CanvasTrack.svelte';
  import DOMTrack from './tracks/DOMTrack.svelte';
  import TrackLabel from './tracks/TrackLabel.svelte';
  import TrackContent from './tracks/TrackContent.svelte';
  import { drawRuler, drawVad, drawMouthEnergy, drawWaveform, drawHeadPose } from './tracks/draw-functions.js';
  import { extractWaveform } from './utils/extract-waveform.js';
  import { getTheme } from '$lib/stores/theme.svelte';
  import { PALETTE_DARK, PALETTE_LIGHT } from './viewer-palette.js';
  import { browser } from '$app/environment';

  import './viewer.css';

  interface Props {
    videoId: string;
  }

  const props: Props = $props();

  // Create state
  const timeline = new TimelineState();
  const annotations = new AnnotationDataState();
  const session = new SessionState(props.videoId);

  // Provide via context
  setTimelineState(timeline);
  setAnnotationDataState(annotations);
  setSessionState(session);

  // Theme-aware palette for canvas draw functions
  const theme = getTheme();
  let prefersDark = $state(browser ? window.matchMedia('(prefers-color-scheme: dark)').matches : true);

  if (browser) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      prefersDark = e.matches;
    });
  }

  const isDark = $derived(
    theme.value === 'dark' || (theme.value === 'system' && prefersDark)
  );
  const palette = $derived(isDark ? PALETTE_DARK : PALETTE_LIGHT);

  // tRPC client
  const supabase = createSupabaseBrowserClient();
  const trpc = createTRPCClientInstance(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  });

  // Component refs
  let videoPlayer = $state<VideoPlayer>();
  let timelineContainerEl: HTMLDivElement;
  let labelColumnEl: HTMLDivElement;
  let loadError = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Track visibility: show when loading, loaded, OR error (so user can see failures)
  function isTrackVisible(status: string): boolean {
    return status === 'loaded' || status === 'loading' || status === 'error';
  }

  const showVad = $derived(isTrackVisible(annotations.loadStatus.vad));
  const hasVad = $derived(annotations.loadStatus.vad === 'loaded' && !!annotations.vad?.frames);
  const showMouthEnergy = $derived(isTrackVisible(annotations.loadStatus.mouth_energy));
  const hasMouthEnergy = $derived(annotations.loadStatus.mouth_energy === 'loaded' && !!annotations.mouthEnergy?.data);
  const showTranscription = $derived(isTrackVisible(annotations.loadStatus.transcription));
  const hasTranscription = $derived(annotations.loadStatus.transcription === 'loaded' && !!annotations.transcription?.data);
  const showHeadPose = $derived(isTrackVisible(annotations.loadStatus.facial_tracking));
  const hasHeadPose = $derived(annotations.loadStatus.facial_tracking === 'loaded' && !!annotations.facialTracking?.data);

  // Total timeline width in pixels
  const timelineWidth = $derived(timeline.timeToPx(timeline.duration));

  // --- Draw function wrappers that capture annotation data + palette ---
  function drawRulerTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    drawRuler(ctx, w, h, vp, palette);
  }

  function drawWaveformTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (session.waveformPeaksL) {
      drawWaveform(ctx, w, h, vp, session.waveformPeaksL, session.waveformPeaksR, session.waveformSampleRate, palette);
    }
  }

  function drawVadTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.vad?.frames) drawVad(ctx, w, h, vp, annotations.vad.frames, palette);
  }

  function drawMouthEnergyTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.mouthEnergy?.data) drawMouthEnergy(ctx, w, h, vp, annotations.mouthEnergy.data, palette);
  }

  function drawHeadPoseTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.facialTracking?.data) drawHeadPose(ctx, w, h, vp, annotations.facialTracking.data, palette);
  }

  // --- DOM track helpers ---
  function transcriptionBlockClass(item: SpeechWord): string {
    return item.speech.speaker === 'SPEAKER_00' ? 'block-speaker-0' : 'block-speaker-1';
  }

  function transcriptionBlockLabel(item: SpeechWord): string {
    return item.speech.word;
  }

  function getTimeRangeStart(item: { time_range: { start: number } }): number {
    return item.time_range.start;
  }

  function getTimeRangeEnd(item: { time_range: { end: number } }): number {
    return item.time_range.end;
  }

  function handleBlockClick(item: Record<string, unknown>) {
    session.selectedAnnotation = item;
  }

  // --- Scrub to seek ---
  function handleScrub(time: number) {
    timeline.currentTime = time;
    videoPlayer?.seek(time);
  }

  // --- Video controls ---
  function togglePlay() {
    videoPlayer?.toggle();
  }

  function togglePip() {
    videoPlayer?.togglePip();
  }

  function seekTo(time: number) {
    videoPlayer?.seek(time);
  }

  // --- Scroll sync ---
  function handleTimelineScroll() {
    if (timelineContainerEl) {
      timeline.scrollLeft = timelineContainerEl.scrollLeft;
      // Sync vertical scroll to label column
      if (labelColumnEl) {
        labelColumnEl.scrollTop = timelineContainerEl.scrollTop;
      }
    }
  }

  // --- Cmd/Ctrl+wheel zoom (proportional) ---
  function handleWheel(e: WheelEvent) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      timeline.zoom = Math.max(0.5, Math.min(100, timeline.zoom * factor));
    }
  }

  // --- Keyboard shortcuts ---
  function handleKeydown(e: KeyboardEvent) {
    // Don't capture if focus is on an input
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekTo(timeline.currentTime - (e.shiftKey ? 5 : 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekTo(timeline.currentTime + (e.shiftKey ? 5 : 1));
        break;
      case 'Home':
        e.preventDefault();
        seekTo(0);
        break;
      case 'End':
        e.preventDefault();
        seekTo(timeline.duration);
        break;
      case 'KeyP':
        e.preventDefault();
        togglePip();
        break;
    }
  }

  // --- Auto-scroll during playback ---
  $effect(() => {
    if (!timeline.playing || !timelineContainerEl) return;

    const playheadX = timeline.timeToPx(timeline.currentTime) - timeline.scrollLeft;
    const rightEdge = timeline.containerWidth - 100;

    if (playheadX > rightEdge) {
      const newScrollLeft = timeline.timeToPx(timeline.currentTime) - 100;
      timeline.scrollLeft = newScrollLeft;
      timelineContainerEl.scrollLeft = newScrollLeft;
    }
  });

  // --- Fit zoom to container when duration and width are known ---
  $effect(() => {
    timeline.containerWidth;
    timeline.duration;
    timeline.fitZoomToContainer();
  });

  // --- ResizeObserver for timeline container ---
  onMount(() => {
    if (timelineContainerEl) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          timeline.containerWidth = entry.contentRect.width;
        }
      });
      observer.observe(timelineContainerEl);

      // Load data
      loadViewerData();

      return () => {
        observer.disconnect();
        if (pollTimer) clearInterval(pollTimer);
      };
    }
  });

  // --- Waveform extraction ---
  async function loadWaveform(url: string) {
    session.waveformLoading = true;
    try {
      const waveform = await extractWaveform(url);
      session.waveformPeaksL = waveform.peaksL;
      session.waveformPeaksR = waveform.peaksR;
      session.waveformSampleRate = waveform.sampleRate;
    } catch {
      // Waveform is non-critical — fail silently
    } finally {
      session.waveformLoading = false;
    }
  }

  // --- Facial tracking (lazy-loaded separately — too large for getAllResults) ---
  async function loadFacialTracking() {
    const status = { ...annotations.loadStatus };
    status.facial_tracking = 'loading';
    annotations.loadStatus = status;
    try {
      const data = await trpc.processing.getResults.query({
        videoId: props.videoId,
        stage: 'facial_tracking',
      });
      annotations.facialTracking = data as FacialTrackingResult;
      annotations.loadStatus = { ...annotations.loadStatus, facial_tracking: 'loaded' };
    } catch {
      annotations.loadStatus = { ...annotations.loadStatus, facial_tracking: 'error' };
    }
  }

  // --- Data loading ---
  async function loadViewerData() {
    try {
      // Fetch video info and stream URL in parallel
      const [videoInfo, streamInfo] = await Promise.all([
        trpc.videos.get.query({ id: props.videoId }),
        trpc.videos.getStreamUrl.query({ id: props.videoId }),
      ]);

      session.filename = videoInfo.filename;
      session.videoSrc = streamInfo.url;
      if (videoInfo.durationSecs) {
        timeline.duration = videoInfo.durationSecs;
      }

      // Start waveform extraction (non-blocking)
      loadWaveform(streamInfo.url);

      // Set initial load statuses from existing jobs
      let hasFacialTracking = false;
      console.log('[viewer] Processing jobs:', videoInfo.processingJobs.map((j: { stage: string; status: string }) => `${j.stage}:${j.status}`));
      for (const job of videoInfo.processingJobs) {
        const status = annotations.loadStatus;
        if (job.status === 'completed') {
          status[job.stage] = 'loading';
          if (job.stage === 'facial_tracking') hasFacialTracking = true;
        } else if (job.status === 'failed') {
          status[job.stage] = 'error';
        } else if (job.status === 'running' || job.status === 'pending') {
          status[job.stage] = 'loading';
        }
        annotations.loadStatus = { ...status };
      }
      console.log('[viewer] Load statuses after job scan:', { ...annotations.loadStatus });

      // Fetch all completed results (excludes facial_tracking)
      await loadResults();

      // Lazy-load facial tracking separately (non-blocking)
      if (hasFacialTracking) {
        loadFacialTracking();
      }

      // Poll if any stages still running
      const hasActive = videoInfo.processingJobs.some(
        (j) => j.status === 'running' || j.status === 'pending'
      );
      if (hasActive) {
        pollTimer = setInterval(pollForUpdates, 5000);
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load viewer data';
    }
  }

  async function loadResults() {
    try {
      const { results, jobStatuses } = await trpc.processing.getAllResults.query({
        videoId: props.videoId,
      });

      console.log('[viewer] getAllResults:', {
        resultKeys: Object.keys(results),
        jobStatuses: jobStatuses.map((j: { stage: string; status: string }) => `${j.stage}:${j.status}`),
      });

      // Update load statuses
      const status = { ...annotations.loadStatus };
      for (const { stage, status: jobStatus } of jobStatuses) {
        // Skip facial_tracking — loaded separately
        if (stage === 'facial_tracking') continue;
        if (jobStatus === 'completed' && stage in results) {
          status[stage] = 'loaded';
        } else if (jobStatus === 'completed') {
          console.warn(`[viewer] Stage ${stage} completed but no result data — marking as error`);
          status[stage] = 'error';
        } else if (jobStatus === 'failed') {
          status[stage] = 'error';
        } else if (jobStatus === 'running' || jobStatus === 'pending') {
          status[stage] = 'loading';
        }
      }
      annotations.loadStatus = status;
      console.log('[viewer] Final load statuses:', { ...status });

      // Assign results to state
      if (results.vad) annotations.vad = results.vad as VadResult;
      if (results.transcription) annotations.transcription = results.transcription as TranscriptionResult;
      if (results.diarization) annotations.diarization = results.diarization as DiarizationResult;
      if (results.mouth_energy) annotations.mouthEnergy = results.mouth_energy as MouthEnergyResult;
      if (results.state_annotation) annotations.stateAnnotation = results.state_annotation as StateAnnotationResult;
      if (results.intent_classification) annotations.intentClassification = results.intent_classification as IntentClassificationResult;
    } catch (e) {
      console.error('[viewer] loadResults failed:', e);
    }
  }

  async function pollForUpdates() {
    try {
      const jobs = await trpc.processing.getJobStatus.query({ videoId: props.videoId });

      const hasActive = jobs.some(
        (j) => j.status === 'running' || j.status === 'pending'
      );

      // Check for newly completed stages
      const status = { ...annotations.loadStatus };
      let hasNewCompletions = false;
      for (const job of jobs) {
        if (job.status === 'completed' && status[job.stage] !== 'loaded') {
          hasNewCompletions = true;
          status[job.stage] = 'loading';
        } else if (job.status === 'failed') {
          status[job.stage] = 'error';
        }
      }
      annotations.loadStatus = status;

      if (hasNewCompletions) {
        await loadResults();
        // Check if facial_tracking just completed
        if (status.facial_tracking === 'loading' && !annotations.facialTracking) {
          loadFacialTracking();
        }
      }

      if (!hasActive && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    } catch {
      // Silently ignore poll errors
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="viewer-theme h-screen w-screen flex flex-col overflow-hidden">
  <ViewerHeader onTogglePlay={togglePlay} onSeek={seekTo} onTogglePip={togglePip} />

  {#if loadError}
    <div class="px-4 py-2 bg-red-900/30 text-red-400 text-sm border-b border-red-800/50">
      {loadError}
    </div>
  {/if}

  <div class="flex-1 flex overflow-hidden">
    <!-- Left panel: Video + Inspector -->
    <div
      class="flex flex-col border-r border-viewer-border transition-[width] duration-200 {session.pipActive ? 'w-0 overflow-hidden border-0' : ''}"
      style={session.pipActive ? undefined : 'width: 40%'}
    >
      <div class="flex-1 min-h-0">
        {#if session.videoSrc}
          <VideoPlayer bind:this={videoPlayer} src={session.videoSrc} />
        {:else}
          <div class="w-full h-full flex items-center justify-center bg-black">
            <span class="text-viewer-text-dim text-sm">Loading video...</span>
          </div>
        {/if}
      </div>
      <div class="h-48 border-t border-viewer-border shrink-0">
        <InspectorPanel />
      </div>
    </div>

    <!-- Right panel: Timeline (two-column layout) -->
    <div class="flex-1 flex min-w-0">
      <!-- Fixed label column -->
      <div
        bind:this={labelColumnEl}
        class="shrink-0 overflow-hidden bg-viewer-surface"
        style="width: 120px"
      >
        <TrackLabel label="Time" height={32} />
        <TrackLabel label="Waveform" height={64} />
        {#if showVad}
          <TrackLabel label="VAD" height={48} />
        {/if}
        {#if showHeadPose}
          <TrackLabel label="Head Pose" height={64} />
        {/if}
        {#if showMouthEnergy}
          <TrackLabel label="Mouth Energy" />
        {/if}
        {#if showTranscription}
          <TrackLabel label="Transcription" />
        {/if}
        <!-- TODO: Diarization, States, Intents labels (in-development) -->
      </div>

      <!-- Scrollable content area -->
      <div
        bind:this={timelineContainerEl}
        class="flex-1 overflow-x-auto overflow-y-auto viewer-timeline bg-viewer-bg"
        onscroll={handleTimelineScroll}
        onwheel={handleWheel}
      >
        <div class="relative" style="width: {timelineWidth}px; min-width: 100%;">
          <!-- Playhead (absolute position: x=0 is time=0) -->
          <Playhead />

          <!-- Ruler -->
          <TrackContent height={32}>
            <CanvasTrack height={32} draw={drawRulerTrack} onScrub={handleScrub} />
          </TrackContent>

          <!-- Waveform -->
          <TrackContent height={64}>
            {#if session.waveformPeaksL}
              <CanvasTrack height={64} draw={drawWaveformTrack} onScrub={handleScrub} />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <span class="text-viewer-sm text-viewer-text-dim">
                  {session.waveformLoading ? 'Extracting audio...' : ''}
                </span>
              </div>
            {/if}
          </TrackContent>

          <!-- VAD -->
          {#if showVad}
            <TrackContent height={48}>
              {#if hasVad}
                <CanvasTrack height={48} draw={drawVadTrack} onScrub={handleScrub} />
              {:else if annotations.loadStatus.vad === 'error'}
                <div class="w-full h-full flex items-center justify-center">
                  <span class="text-viewer-sm text-red-400">Failed to load VAD data</span>
                </div>
              {:else}
                <div class="w-full h-full flex items-center justify-center">
                  <span class="text-viewer-sm text-viewer-text-dim">Loading...</span>
                </div>
              {/if}
            </TrackContent>
          {/if}

          <!-- Head Pose (from facial tracking) -->
          {#if showHeadPose}
            <TrackContent height={64}>
              {#if hasHeadPose}
                <CanvasTrack height={64} draw={drawHeadPoseTrack} onScrub={handleScrub} />
              {:else if annotations.loadStatus.facial_tracking === 'error'}
                <div class="w-full h-full flex items-center justify-center">
                  <span class="text-viewer-sm text-red-400">Failed to load head pose data</span>
                </div>
              {:else}
                <div class="w-full h-full flex items-center justify-center">
                  <span class="text-viewer-sm text-viewer-text-dim">Loading...</span>
                </div>
              {/if}
            </TrackContent>
          {/if}

          <!-- Mouth Energy -->
          {#if showMouthEnergy}
            <TrackContent>
              {#if hasMouthEnergy}
                <CanvasTrack draw={drawMouthEnergyTrack} onScrub={handleScrub} />
              {:else if annotations.loadStatus.mouth_energy === 'error'}
                <div class="w-full h-full flex items-center justify-center">
                  <span class="text-viewer-sm text-red-400">Failed to load mouth energy data</span>
                </div>
              {:else}
                <div class="w-full h-full flex items-center justify-center">
                  <span class="text-viewer-sm text-viewer-text-dim">Loading...</span>
                </div>
              {/if}
            </TrackContent>
          {/if}

          <!-- Transcription (DOM track) -->
          {#if showTranscription}
            <TrackContent>
              {#if hasTranscription}
                <DOMTrack
                  data={annotations.transcription!.data}
                  getStart={getTimeRangeStart}
                  getEnd={getTimeRangeEnd}
                  blockClass={transcriptionBlockClass}
                  blockLabel={transcriptionBlockLabel}
                  onBlockClick={(item) => handleBlockClick(item as unknown as Record<string, unknown>)}
                />
              {:else if annotations.loadStatus.transcription === 'error'}
                <div class="w-full h-full flex items-center justify-center">
                  <span class="text-viewer-sm text-red-400">Failed to load transcription data</span>
                </div>
              {:else}
                <div class="w-full h-full flex items-center justify-center">
                  <span class="text-viewer-sm text-viewer-text-dim">Loading...</span>
                </div>
              {/if}
            </TrackContent>
          {/if}

          <!-- TODO: Diarization, States, Intents tracks (in-development) -->
        </div>
      </div>
    </div>
  </div>
</div>
