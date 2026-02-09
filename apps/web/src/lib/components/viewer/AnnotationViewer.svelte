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
    UserLabel,
    UserLabelResult,
  } from '@annotation/shared';
  import type { Viewport } from './types.js';

  import { TimelineState } from './state/timeline.svelte.js';
  import { AnnotationDataState } from './state/annotation-data.svelte.js';
  import { SessionState } from './state/session.svelte.js';
  import { EditorState } from './state/editor.svelte.js';
  import {
    setTimelineState,
    setAnnotationDataState,
    setSessionState,
    setEditorState,
  } from './context.js';

  import ViewerHeader from './ViewerHeader.svelte';
  import VideoPlayer from './VideoPlayer.svelte';
  import InspectorPanel from './InspectorPanel.svelte';
  import Playhead from './Playhead.svelte';
  import CanvasTrack from './tracks/CanvasTrack.svelte';
  import DOMTrack from './tracks/DOMTrack.svelte';
  import EditableDOMTrack from './tracks/EditableDOMTrack.svelte';
  import TrackLabel from './tracks/TrackLabel.svelte';
  import TrackContent from './tracks/TrackContent.svelte';
  import { drawRuler, drawVad, drawMouthEnergy, drawWaveform, drawHeadPose } from './tracks/draw-functions.js';
  import { extractWaveform } from './utils/extract-waveform.js';
  import { getWaveformFromCache, setWaveformInCache } from './utils/waveform-cache.js';
  import { getCachedAnnotation, setCachedAnnotation } from './utils/annotation-cache.js';
  import { getTheme } from '$lib/stores/theme.svelte';
  import { PALETTE_DARK, PALETTE_LIGHT } from './viewer-palette.js';
  import { browser } from '$app/environment';

  import { deleteAnnotation, splitAnnotation, mergeAnnotations } from './editing/operations.js';
  import type { EditableType } from './state/editor.svelte.js';
  import { AutoSaveState } from './state/autosave.svelte.js';
  import type { AnnotationSetType } from '@annotation/shared';
  import DraftRecoveryBanner from './components/DraftRecoveryBanner.svelte';
  import LabelTextDialog from './components/LabelTextDialog.svelte';
  import CreateAnnotationBar from './components/CreateAnnotationBar.svelte';

  import './viewer.css';

  interface Props {
    videoId: string;
    taskId?: string;
  }

  const props: Props = $props();

  // Create state
  const timeline = new TimelineState();
  const annotations = new AnnotationDataState();
  const session = new SessionState(props.videoId);
  const editor = new EditorState();

  // Provide via context
  setTimelineState(timeline);
  setAnnotationDataState(annotations);
  setSessionState(session);
  setEditorState(editor);

  // Auto-save: wraps tRPC save mutation for annotation persistence
  const autosave = new AutoSaveState(editor, props.videoId, async (videoId, type, data) => {
    await trpc.annotations.save.mutate({
      videoId,
      type: type as AnnotationSetType,
      data,
      edits: [],
    });
  });

  // Check for existing draft on mount
  let pendingDraft = $state(AutoSaveState.loadDraft(props.videoId));

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
  // Maps stage → completedAt ISO string for cache keying
  let completedAtMap: Record<string, string> = {};

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
  // User labels: show in view mode if data exists, or always in edit mode
  const hasUserLabels = $derived(
    (editor.editing && editor.userLabels !== null) ||
    (!editor.editing && !!annotations.userLabels?.data?.length)
  );

  // Total timeline width in pixels
  const timelineWidth = $derived(timeline.timeToPx(timeline.duration));

  // --- Draw function wrappers that capture annotation data + palette ---
  function drawRulerTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    drawRuler(ctx, w, h, vp, palette);
  }

  function drawWaveformTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (session.waveformPeaksL) {
      drawWaveform(ctx, w, h, vp, session.waveformPeaksL, session.waveformPeaksR, session.waveformSampleRate, palette,
        session.normalized ? session.waveformMaxPeak : undefined);
    }
  }

  function drawVadTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.vad?.frames) {
      drawVad(ctx, w, h, vp, annotations.vad.frames, palette,
        session.normalized ? annotations.vadMax : undefined);
    }
  }

  function drawMouthEnergyTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.mouthEnergy?.data) {
      drawMouthEnergy(ctx, w, h, vp, annotations.mouthEnergy.data, palette,
        session.normalized ? annotations.mouthEnergyMax : undefined);
    }
  }

  function drawHeadPoseTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.facialTracking?.data) {
      drawHeadPose(ctx, w, h, vp, annotations.facialTracking.data, palette,
        session.normalized ? { min: annotations.headPoseMin, max: annotations.headPoseMax } : undefined);
    }
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

  // --- User label helpers ---
  function userLabelBlockClass(): string {
    return 'block-user-label';
  }

  function userLabelBlockLabel(item: UserLabel): string {
    return item.text;
  }

  function handleLabelDoubleClick(_item: UserLabel, index: number) {
    const labels = editor.userLabels;
    if (labels && index < labels.length) {
      labelTextDialogCurrent = labels[index].text;
      showLabelTextDialog = true;
    }
  }

  function handleLabelTextConfirm(text: string) {
    if (!editor.userLabels || editor.selectedIndex === null) return;
    const idx = editor.selectedIndex;
    if (idx >= editor.userLabels.length) return;

    pushUndoForType('userLabels');
    const updated = [...editor.userLabels];
    updated[idx] = { ...updated[idx], text };
    editor.userLabels = updated;
    editor.lastEditedType = 'userLabels';
    editor.markDirty('userLabels');
    showLabelTextDialog = false;
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

  // --- Edit mode ---
  function toggleEditMode() {
    if (editor.editing) {
      // Write edited user labels back to annotationData so they persist in view mode
      if (editor.userLabels && editor.userLabels.length > 0) {
        annotations.userLabels = {
          metadata: annotations.userLabels?.metadata ?? {
            source_file: '',
            format_version: '1.0',
            created_timestamp: new Date().toISOString(),
            total_secs: timeline.duration,
            algorithm: { name: 'human', model: 'manual', version: '1.0', processing_time: 0 },
          },
          data: structuredClone($state.snapshot(editor.userLabels)),
        };
      } else if (editor.userLabels && editor.userLabels.length === 0) {
        annotations.userLabels = null;
      }
      editor.exitEditMode();
    } else {
      editor.enterEditMode(annotations);
    }
  }

  // --- Editing operation helpers ---
  function pushUndoForType(type: EditableType) {
    // $state.snapshot() unwraps Svelte 5 proxies before structuredClone
    switch (type) {
      case 'states':
        if (editor.states) editor.stateHistory.push(structuredClone($state.snapshot(editor.states)));
        break;
      case 'intents':
        if (editor.intents) editor.intentHistory.push(structuredClone($state.snapshot(editor.intents)));
        break;
      case 'transcription':
        if (editor.transcription) editor.transcriptionHistory.push(structuredClone($state.snapshot(editor.transcription)));
        break;
      case 'backchannels':
        if (editor.backchannels) editor.backchannelHistory.push(structuredClone($state.snapshot(editor.backchannels)));
        break;
      case 'userLabels':
        if (editor.userLabels) editor.userLabelHistory.push(structuredClone($state.snapshot(editor.userLabels)));
        break;
    }
  }

  function applyOperation(type: EditableType, newArray: unknown[]) {
    (editor as unknown as Record<string, unknown>)[type] = newArray;
    editor.lastEditedType = type;
    editor.markDirty(type);
  }

  function deleteSelected() {
    if (!editor.hasSelection || editor.selectedType === null || editor.selectedIndex === null) return;
    const type = editor.selectedType;
    const idx = editor.selectedIndex;
    const arr = editor[type];
    if (!arr || idx >= arr.length) return;

    pushUndoForType(type);
    applyOperation(type, deleteAnnotation(arr as unknown[], idx));
    editor.deselect();
  }

  function splitSelected() {
    if (!editor.hasSelection || editor.selectedType === null || editor.selectedIndex === null) return;
    const type = editor.selectedType;
    const idx = editor.selectedIndex;
    const arr = editor[type] as { time_range: { start: number; end: number } }[] | null;
    if (!arr || idx >= arr.length) return;

    const item = arr[idx];
    const playhead = timeline.currentTime;
    // Validate split point is within the annotation
    if (playhead <= item.time_range.start + 0.05 || playhead >= item.time_range.end - 0.05) return;

    pushUndoForType(type);
    applyOperation(type, splitAnnotation(arr as { time_range: { start: number; end: number } }[], idx, playhead));
  }

  function mergeSelected() {
    if (!editor.hasSelection || editor.selectedType === null || editor.selectedIndex === null) return;
    const type = editor.selectedType;
    const idx = editor.selectedIndex;
    const arr = editor[type] as { time_range: { start: number; end: number } }[] | null;
    if (!arr) return;

    // Try merging with next, then with previous
    const mergeArr = arr as { time_range: { start: number; end: number } }[];
    if (idx + 1 < arr.length) {
      pushUndoForType(type);
      applyOperation(type, mergeAnnotations(mergeArr, idx, idx + 1));
    } else if (idx > 0) {
      pushUndoForType(type);
      applyOperation(type, mergeAnnotations(mergeArr, idx - 1, idx));
      editor.select(type, idx - 1);
    }
  }

  function selectNextAnnotation(reverse: boolean) {
    if (!editor.editing) return;

    // If nothing is selected, select the first/last in the first available type
    if (!editor.hasSelection || editor.selectedType === null || editor.selectedIndex === null) {
      const types: EditableType[] = ['states', 'intents', 'transcription', 'backchannels', 'userLabels'];
      for (const type of types) {
        const arr = editor[type];
        if (arr && arr.length > 0) {
          editor.select(type, reverse ? arr.length - 1 : 0);
          return;
        }
      }
      return;
    }

    const type = editor.selectedType;
    const arr = editor[type];
    if (!arr) return;

    const nextIdx = editor.selectedIndex + (reverse ? -1 : 1);
    if (nextIdx >= 0 && nextIdx < arr.length) {
      editor.select(type, nextIdx);
    }
  }

  // Dialog state
  let showClassifyDialog = $state(false);
  let showLabelTextDialog = $state(false);
  let labelTextDialogCurrent = $state('');
  let showShortcutsHelp = $state(false);

  // --- Keyboard shortcuts ---
  function handleKeydown(e: KeyboardEvent) {
    // Don't capture if focus is on an input or textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.target as HTMLElement)?.isContentEditable) return;

    const mod = e.metaKey || e.ctrlKey;

    // ? — toggle keyboard shortcuts help
    if (e.key === '?' && !mod) {
      e.preventDefault();
      showShortcutsHelp = !showShortcutsHelp;
      return;
    }

    // Don't process other shortcuts while help overlay is open
    if (showShortcutsHelp) return;

    // Ctrl/Cmd+Z — undo, Ctrl/Cmd+Shift+Z — redo
    if (mod && e.code === 'KeyZ') {
      if (editor.editing) {
        e.preventDefault();
        if (e.shiftKey) {
          editor.redo();
        } else {
          editor.undo();
        }
      }
      return;
    }

    // Ctrl/Cmd+E — toggle edit mode
    if (mod && e.code === 'KeyE') {
      e.preventDefault();
      toggleEditMode();
      return;
    }

    // Ctrl/Cmd+S — force save (prevent browser save dialog)
    if (mod && e.code === 'KeyS') {
      e.preventDefault();
      if (editor.editing && editor.hasChanges) {
        autosave.saveNow();
      }
      return;
    }

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
      case 'KeyN':
        e.preventDefault();
        if (!editor.editing) {
          session.normalized = !session.normalized;
        }
        // In edit mode, N creates annotation — handled by CreateAnnotationBar
        break;
      case 'Delete':
      case 'Backspace':
        if (editor.editing && editor.hasSelection) {
          e.preventDefault();
          deleteSelected();
        }
        break;
      case 'KeyS':
        if (editor.editing && editor.hasSelection) {
          e.preventDefault();
          splitSelected();
        }
        break;
      case 'KeyM':
        if (editor.editing && editor.hasSelection) {
          e.preventDefault();
          mergeSelected();
        }
        break;
      case 'KeyC':
        if (editor.editing && editor.hasSelection) {
          e.preventDefault();
          if (editor.selectedType === 'userLabels') {
            const labels = editor.userLabels;
            const idx = editor.selectedIndex;
            if (labels && idx !== null && idx < labels.length) {
              labelTextDialogCurrent = labels[idx].text;
              showLabelTextDialog = true;
            }
          } else {
            showClassifyDialog = true;
          }
        }
        break;
      case 'Tab':
        if (editor.editing) {
          e.preventDefault();
          selectNextAnnotation(e.shiftKey);
        }
        break;
      case 'Escape':
        if (editor.editing) {
          e.preventDefault();
          if (editor.hasSelection) {
            editor.deselect();
          } else {
            editor.exitEditMode();
          }
        }
        break;
    }
  }

  // --- Auto-scroll during playback ---
  $effect(() => {
    if (!timeline.playing || !timelineContainerEl) return;

    const playheadX = timeline.timeToPx(timeline.currentTime) - timeline.scrollLeft;
    const rightEdge = timeline.containerWidth - 100;

    if (playheadX > rightEdge) {
      const newScrollLeft = Math.min(
        timeline.timeToPx(timeline.currentTime) - 100,
        timeline.maxScrollLeft
      );
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

  // --- Auto-save: watch dirty state and trigger draft backup + debounced server save ---
  $effect(() => {
    const dirty = editor.hasChanges;
    if (dirty) {
      autosave.saveDraft();
      autosave.scheduleSave();
    }
  });

  // --- Draft recovery handlers ---
  function restoreDraft() {
    if (!pendingDraft) return;
    editor.enterEditMode(annotations);
    if (pendingDraft.states) editor.states = pendingDraft.states as typeof editor.states;
    if (pendingDraft.intents) editor.intents = pendingDraft.intents as typeof editor.intents;
    if (pendingDraft.transcription) editor.transcription = pendingDraft.transcription as typeof editor.transcription;
    if (pendingDraft.backchannels) editor.backchannels = pendingDraft.backchannels as typeof editor.backchannels;
    if (pendingDraft.userLabels) editor.userLabels = pendingDraft.userLabels as typeof editor.userLabels;
    pendingDraft = null;
  }

  function discardDraft() {
    AutoSaveState.discardDraft(props.videoId);
    pendingDraft = null;
  }

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
        autosave.dispose();
      };
    }
  });

  // --- Normalization range computation ---
  function computeDataRanges() {
    if (annotations.vad?.frames) {
      let max = 0;
      for (const frame of annotations.vad.frames) {
        if (frame.speech_probability > max) max = frame.speech_probability;
      }
      annotations.vadMax = max || 1;
    }

    if (annotations.mouthEnergy?.data) {
      let max = 0;
      for (const seg of annotations.mouthEnergy.data) {
        if (seg.mouth_energy.mouth_energy > max) max = seg.mouth_energy.mouth_energy;
      }
      annotations.mouthEnergyMax = max || 1;
    }
  }

  function computeHeadPoseRange() {
    if (!annotations.facialTracking?.data) return;
    let min = Infinity, max = -Infinity;
    for (const frame of annotations.facialTracking.data) {
      if (!frame.facial_tracking.tracking.face_detected) continue;
      for (const angle of frame.facial_tracking.tracking.head_pose.rotation) {
        if (angle < min) min = angle;
        if (angle > max) max = angle;
      }
    }
    if (min !== Infinity) {
      const padding = (max - min) * 0.1 || 1;
      annotations.headPoseMin = min - padding;
      annotations.headPoseMax = max + padding;
    }
  }

  // --- Waveform extraction (with IndexedDB cache) ---
  async function loadWaveform(url: string) {
    session.waveformLoading = true;
    try {
      // Check cache first
      const cached = await getWaveformFromCache(props.videoId);
      if (cached) {
        console.log('[viewer] Waveform loaded from cache');
        session.waveformPeaksL = cached.peaksL;
        session.waveformPeaksR = cached.peaksR;
        session.waveformSampleRate = cached.sampleRate;
        session.waveformMaxPeak = cached.maxPeak;
        return;
      }

      // Cache miss — extract from video
      const waveform = await extractWaveform(url);
      session.waveformPeaksL = waveform.peaksL;
      session.waveformPeaksR = waveform.peaksR;
      session.waveformSampleRate = waveform.sampleRate;

      // Compute peak max for normalization
      let maxPeak = 0;
      for (let i = 0; i < waveform.peaksL.length; i++) {
        if (waveform.peaksL[i] > maxPeak) maxPeak = waveform.peaksL[i];
      }
      if (waveform.peaksR) {
        for (let i = 0; i < waveform.peaksR.length; i++) {
          if (waveform.peaksR[i] > maxPeak) maxPeak = waveform.peaksR[i];
        }
      }
      session.waveformMaxPeak = maxPeak || 1;

      // Store in cache (fire-and-forget)
      setWaveformInCache(props.videoId, {
        peaksL: waveform.peaksL,
        peaksR: waveform.peaksR,
        sampleRate: waveform.sampleRate,
        duration: timeline.duration,
        maxPeak: session.waveformMaxPeak,
      });
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
      // Check annotation cache first
      const completedAt = completedAtMap['facial_tracking'];
      if (completedAt) {
        const cached = await getCachedAnnotation<FacialTrackingResult>(props.videoId, 'facial_tracking', completedAt);
        if (cached) {
          console.log('[viewer] facial_tracking loaded from cache');
          annotations.facialTracking = cached;
          annotations.loadStatus = { ...annotations.loadStatus, facial_tracking: 'loaded' };
          computeHeadPoseRange();
          return;
        }
      }

      const data = await trpc.processing.getResults.query({
        videoId: props.videoId,
        stage: 'facial_tracking',
      });
      annotations.facialTracking = data as FacialTrackingResult;
      annotations.loadStatus = { ...annotations.loadStatus, facial_tracking: 'loaded' };
      computeHeadPoseRange();

      // Cache for next load (fire-and-forget)
      if (completedAt) {
        setCachedAnnotation(props.videoId, 'facial_tracking', completedAt, data);
      }
    } catch {
      annotations.loadStatus = { ...annotations.loadStatus, facial_tracking: 'error' };
    }
  }

  // --- Load human annotation sets from DB ---
  async function loadAnnotationSets() {
    try {
      const userLabelSet = await trpc.annotations.get.query({
        videoId: props.videoId,
        type: 'user_labels',
      });
      if (userLabelSet?.data) {
        const data = userLabelSet.data as UserLabel[];
        annotations.userLabels = {
          metadata: (userLabelSet.metadata as UserLabelResult['metadata']) ?? {
            source_file: '',
            format_version: '1.0',
            created_timestamp: new Date().toISOString(),
            total_secs: timeline.duration,
            algorithm: { name: 'human', model: 'manual', version: '1.0', processing_time: 0 },
          },
          data,
        };
      }
    } catch (e) {
      console.warn('[viewer] Failed to load annotation sets:', e);
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

      // Build completedAt map for cache keying
      completedAtMap = {};
      for (const job of videoInfo.processingJobs) {
        if (job.status === 'completed' && job.completedAt) {
          completedAtMap[job.stage] = job.completedAt instanceof Date
            ? job.completedAt.toISOString()
            : String(job.completedAt);
        }
      }

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

      // Load human annotation sets from DB (user_labels, etc.)
      loadAnnotationSets();

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
      // Try loading all non-facial-tracking stages from annotation cache
      const stagesWithCache = Object.entries(completedAtMap).filter(([stage]) => stage !== 'facial_tracking');
      const cachedResults: Record<string, unknown> = {};
      let allCached = stagesWithCache.length > 0;

      for (const [stage, completedAt] of stagesWithCache) {
        const cached = await getCachedAnnotation(props.videoId, stage, completedAt);
        if (cached) {
          cachedResults[stage] = cached;
        } else {
          allCached = false;
        }
      }

      if (allCached && stagesWithCache.length > 0) {
        // All completed stages were in cache — skip tRPC call entirely
        console.log('[viewer] All annotation results loaded from cache:', Object.keys(cachedResults));
        assignResults(cachedResults);
        const status = { ...annotations.loadStatus };
        for (const stage of Object.keys(cachedResults)) {
          if (stage in status) {
            (status as Record<string, string>)[stage] = 'loaded';
          }
        }
        annotations.loadStatus = status;
        computeDataRanges();
        return;
      }

      // Cache miss on at least one stage — fetch from server
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

      assignResults(results);
      computeDataRanges();

      // Cache fetched results for next load (fire-and-forget)
      for (const [stage, data] of Object.entries(results)) {
        const completedAt = completedAtMap[stage];
        if (completedAt && data) {
          setCachedAnnotation(props.videoId, stage, completedAt, data);
        }
      }
    } catch (e) {
      console.error('[viewer] loadResults failed:', e);
    }
  }

  function assignResults(results: Record<string, unknown>) {
    if (results.vad) annotations.vad = results.vad as VadResult;
    if (results.transcription) annotations.transcription = results.transcription as TranscriptionResult;
    if (results.diarization) annotations.diarization = results.diarization as DiarizationResult;
    if (results.mouth_energy) annotations.mouthEnergy = results.mouth_energy as MouthEnergyResult;
    if (results.state_annotation) annotations.stateAnnotation = results.state_annotation as StateAnnotationResult;
    if (results.intent_classification) annotations.intentClassification = results.intent_classification as IntentClassificationResult;
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
  <ViewerHeader onTogglePlay={togglePlay} onSeek={seekTo} onTogglePip={togglePip} onToggleEditMode={toggleEditMode} {autosave} {showShortcutsHelp} onToggleShortcutsHelp={() => showShortcutsHelp = !showShortcutsHelp} />

  {#if loadError}
    <div class="px-4 py-2 bg-red-900/30 text-red-400 text-sm border-b border-red-800/50">
      {loadError}
    </div>
  {/if}

  {#if pendingDraft}
    <DraftRecoveryBanner
      draft={pendingDraft}
      onRestore={restoreDraft}
      onDiscard={discardDraft}
    />
  {/if}

  <CreateAnnotationBar />

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
        {#if hasUserLabels}
          <TrackLabel label="User Labels" />
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

          <!-- User Labels -->
          {#if hasUserLabels}
            <TrackContent>
              {#if editor.editing && editor.userLabels}
                <EditableDOMTrack
                  data={editor.userLabels}
                  editableType="userLabels"
                  getStart={getTimeRangeStart}
                  getEnd={getTimeRangeEnd}
                  blockClass={userLabelBlockClass}
                  blockLabel={userLabelBlockLabel}
                  onBlockDoubleClick={handleLabelDoubleClick}
                />
              {:else if annotations.userLabels?.data}
                <DOMTrack
                  data={annotations.userLabels.data}
                  getStart={getTimeRangeStart}
                  getEnd={getTimeRangeEnd}
                  blockClass={userLabelBlockClass}
                  blockLabel={userLabelBlockLabel}
                />
              {/if}
            </TrackContent>
          {/if}

          <!-- TODO: Diarization, States, Intents tracks (in-development) -->
        </div>
      </div>
    </div>
  </div>

  {#if showLabelTextDialog}
    <LabelTextDialog
      currentText={labelTextDialogCurrent}
      onConfirm={handleLabelTextConfirm}
      onClose={() => showLabelTextDialog = false}
    />
  {/if}
</div>
