<script lang="ts">
  import { onMount } from 'svelte';
  import { createSupabaseBrowserClient } from '$lib/supabase';
  import { createTRPCClientInstance } from '$lib/trpc';
  import type {
    VadResult,
    TranscriptionResult,
    DiarizationResult,
    MouthEnergyResult,
    StateAnnotationResult,
    IntentClassificationResult,
    SpeechWord,
    StateAnnotation,
    IntentAnnotation,
  } from '@annotation/shared';
  import type { Viewport } from './types.js';

  import { createTimelineState } from './state/timeline.svelte.js';
  import { createAnnotationDataState } from './state/annotation-data.svelte.js';
  import { createSessionState } from './state/session.svelte.js';
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
  import TrackRow from './tracks/TrackRow.svelte';
  import { drawRuler, drawVad, drawEnergy, drawDiarization, drawMouthEnergy } from './tracks/draw-functions.js';

  import './viewer.css';

  interface Props {
    videoId: string;
  }

  const props: Props = $props();

  // Create state
  const timeline = createTimelineState();
  const annotations = createAnnotationDataState();
  const session = createSessionState(props.videoId);

  // Provide via context
  setTimelineState(timeline);
  setAnnotationDataState(annotations);
  setSessionState(session);

  // tRPC client
  const supabase = createSupabaseBrowserClient();
  const trpc = createTRPCClientInstance(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  });

  // Component refs
  let videoPlayer = $state<VideoPlayer>();
  let timelineContainerEl: HTMLDivElement;
  let loadError = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Total timeline width in pixels
  const timelineWidth = $derived(timeline.timeToPx(timeline.duration));

  // --- Draw function wrappers that capture annotation data ---
  function drawRulerTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    drawRuler(ctx, w, h, vp);
  }

  function drawVadTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.vad?.data) drawVad(ctx, w, h, vp, annotations.vad.data);
  }

  function drawEnergyTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.vad?.data) drawEnergy(ctx, w, h, vp, annotations.vad.data);
  }

  function drawDiarizationTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.diarization?.data) drawDiarization(ctx, w, h, vp, annotations.diarization.data);
  }

  function drawMouthEnergyTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.mouthEnergy?.data) drawMouthEnergy(ctx, w, h, vp, annotations.mouthEnergy.data);
  }

  // --- DOM track helpers ---
  function transcriptionBlockClass(item: SpeechWord): string {
    return item.speech.speaker === 'SPEAKER_00' ? 'block-speaker-0' : 'block-speaker-1';
  }

  function transcriptionBlockLabel(item: SpeechWord): string {
    return item.speech.word;
  }

  function stateBlockClass(item: StateAnnotation): string {
    return item.category.includes('speaking') ? 'block-speaking' : 'block-listening';
  }

  function stateBlockLabel(item: StateAnnotation): string {
    return item.category.includes('speaking') ? 'Speaking' : 'Listening';
  }

  function intentBlockClass(item: IntentAnnotation): string {
    return `block-intent-${item.intent_classification.intent}`;
  }

  function intentBlockLabel(item: IntentAnnotation): string {
    return item.intent_classification.intent;
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

  function seekTo(time: number) {
    videoPlayer?.seek(time);
  }

  // --- Scroll sync ---
  function handleTimelineScroll() {
    if (timelineContainerEl) {
      timeline.scrollLeft = timelineContainerEl.scrollLeft;
    }
  }

  // --- Cmd/Ctrl+wheel zoom ---
  function handleWheel(e: WheelEvent) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.5 : 0.5;
      timeline.zoom = Math.max(0.5, Math.min(20, timeline.zoom + delta));
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

      // Set initial load statuses from existing jobs
      for (const job of videoInfo.processingJobs) {
        const status = annotations.loadStatus;
        if (job.status === 'completed') {
          status[job.stage] = 'loading';
        } else if (job.status === 'failed') {
          status[job.stage] = 'error';
        } else if (job.status === 'running' || job.status === 'pending') {
          status[job.stage] = 'loading';
        }
        annotations.loadStatus = { ...status };
      }

      // Fetch all completed results
      await loadResults();

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

      // Update load statuses
      const status = { ...annotations.loadStatus };
      for (const { stage, status: jobStatus } of jobStatuses) {
        if (jobStatus === 'completed' && stage in results) {
          status[stage] = 'loaded';
        } else if (jobStatus === 'completed') {
          status[stage] = 'error';
        } else if (jobStatus === 'failed') {
          status[stage] = 'error';
        } else if (jobStatus === 'running' || jobStatus === 'pending') {
          status[stage] = 'loading';
        }
      }
      annotations.loadStatus = status;

      // Assign results to state
      if (results.vad) annotations.vad = results.vad as VadResult;
      if (results.transcription) annotations.transcription = results.transcription as TranscriptionResult;
      if (results.diarization) annotations.diarization = results.diarization as DiarizationResult;
      if (results.mouth_energy) annotations.mouthEnergy = results.mouth_energy as MouthEnergyResult;
      if (results.state_annotation) annotations.stateAnnotation = results.state_annotation as StateAnnotationResult;
      if (results.intent_classification) annotations.intentClassification = results.intent_classification as IntentClassificationResult;
    } catch {
      // Individual stage errors handled via loadStatus
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
  <ViewerHeader onTogglePlay={togglePlay} onSeek={seekTo} />

  {#if loadError}
    <div class="px-4 py-2 bg-red-900/30 text-red-400 text-sm border-b border-red-800/50">
      {loadError}
    </div>
  {/if}

  <div class="flex-1 flex overflow-hidden">
    <!-- Left panel: Video + Inspector -->
    <div class="flex flex-col border-r border-viewer-border" style="width: 40%">
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

    <!-- Right panel: Timeline -->
    <div class="flex-1 flex flex-col min-w-0">
      <div
        bind:this={timelineContainerEl}
        class="flex-1 overflow-x-auto overflow-y-auto viewer-timeline bg-viewer-bg"
        onscroll={handleTimelineScroll}
        onwheel={handleWheel}
      >
        <div class="relative" style="width: {timelineWidth}px; min-width: 100%;">
          <!-- Playhead -->
          <Playhead />

          <!-- Ruler -->
          <TrackRow label="Time" height={32}>
            <CanvasTrack height={32} draw={drawRulerTrack} onScrub={handleScrub} />
          </TrackRow>

          <!-- VAD -->
          <TrackRow label="VAD">
            {#if annotations.loadStatus.vad === 'loaded'}
              <CanvasTrack draw={drawVadTrack} onScrub={handleScrub} />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <span class="text-[10px] text-viewer-text-dim">
                  {annotations.loadStatus.vad === 'loading' ? 'Loading...' : annotations.loadStatus.vad === 'error' ? 'Error' : ''}
                </span>
              </div>
            {/if}
          </TrackRow>

          <!-- Energy -->
          <TrackRow label="Energy">
            {#if annotations.loadStatus.vad === 'loaded'}
              <CanvasTrack draw={drawEnergyTrack} onScrub={handleScrub} />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <span class="text-[10px] text-viewer-text-dim">
                  {annotations.loadStatus.vad === 'loading' ? 'Loading...' : annotations.loadStatus.vad === 'error' ? 'Error' : ''}
                </span>
              </div>
            {/if}
          </TrackRow>

          <!-- Diarization -->
          <TrackRow label="Diarization">
            {#if annotations.loadStatus.diarization === 'loaded' && annotations.diarization?.data}
              <CanvasTrack draw={drawDiarizationTrack} onScrub={handleScrub} />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <span class="text-[10px] text-viewer-text-dim">
                  {annotations.loadStatus.diarization === 'loading' ? 'Loading...' : annotations.loadStatus.diarization === 'error' ? 'Error' : ''}
                </span>
              </div>
            {/if}
          </TrackRow>

          <!-- Mouth Energy -->
          <TrackRow label="Mouth Energy">
            {#if annotations.loadStatus.mouth_energy === 'loaded' && annotations.mouthEnergy?.data}
              <CanvasTrack draw={drawMouthEnergyTrack} onScrub={handleScrub} />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <span class="text-[10px] text-viewer-text-dim">
                  {annotations.loadStatus.mouth_energy === 'loading' ? 'Loading...' : annotations.loadStatus.mouth_energy === 'error' ? 'Error' : ''}
                </span>
              </div>
            {/if}
          </TrackRow>

          <!-- Transcription (DOM track) -->
          <TrackRow label="Transcription">
            {#if annotations.loadStatus.transcription === 'loaded' && annotations.transcription?.data}
              <DOMTrack
                data={annotations.transcription.data}
                getStart={getTimeRangeStart}
                getEnd={getTimeRangeEnd}
                blockClass={transcriptionBlockClass}
                blockLabel={transcriptionBlockLabel}
                onBlockClick={(item) => handleBlockClick(item as unknown as Record<string, unknown>)}
              />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <span class="text-[10px] text-viewer-text-dim">
                  {annotations.loadStatus.transcription === 'loading' ? 'Loading...' : annotations.loadStatus.transcription === 'error' ? 'Error' : ''}
                </span>
              </div>
            {/if}
          </TrackRow>

          <!-- States (DOM track) -->
          <TrackRow label="States">
            {#if annotations.loadStatus.state_annotation === 'loaded' && annotations.stateAnnotation?.data}
              <DOMTrack
                data={annotations.stateAnnotation.data}
                getStart={getTimeRangeStart}
                getEnd={getTimeRangeEnd}
                blockClass={stateBlockClass}
                blockLabel={stateBlockLabel}
                onBlockClick={(item) => handleBlockClick(item as unknown as Record<string, unknown>)}
              />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <span class="text-[10px] text-viewer-text-dim">
                  {annotations.loadStatus.state_annotation === 'loading' ? 'Loading...' : annotations.loadStatus.state_annotation === 'error' ? 'Error' : ''}
                </span>
              </div>
            {/if}
          </TrackRow>

          <!-- Intents (DOM track) -->
          <TrackRow label="Intents">
            {#if annotations.loadStatus.intent_classification === 'loaded' && annotations.intentClassification?.data}
              <DOMTrack
                data={annotations.intentClassification.data}
                getStart={getTimeRangeStart}
                getEnd={getTimeRangeEnd}
                blockClass={intentBlockClass}
                blockLabel={intentBlockLabel}
                onBlockClick={(item) => handleBlockClick(item as unknown as Record<string, unknown>)}
              />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <span class="text-[10px] text-viewer-text-dim">
                  {annotations.loadStatus.intent_classification === 'loading' ? 'Loading...' : annotations.loadStatus.intent_classification === 'error' ? 'Error' : ''}
                </span>
              </div>
            {/if}
          </TrackRow>
        </div>
      </div>
    </div>
  </div>
</div>
