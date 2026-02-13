<script lang="ts">
  import { onMount } from 'svelte';
  import { createSupabaseBrowserClient } from '$lib/supabase';
  import { createTRPCClientInstance } from '$lib/trpc';
  import type {
    SpeechWord,
    UserLabel,
    EditType,
    AnnotationSetType,
  } from '@annotation/shared';
  import { groupWordsBySegment, type TranscriptionSegment } from './utils/group-words.js';
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
    setTaskModeState,
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
  import { getTheme } from '$lib/stores/theme.svelte';
  import { PALETTE_DARK, PALETTE_LIGHT } from './viewer-palette.js';
  import { browser } from '$app/environment';

  import { deleteAnnotation, splitAnnotation, mergeAnnotations } from './editing/operations.js';
  import { validateCoverage } from './editing/time-validation.js';
  import type { EditableType } from './state/editor.svelte.js';
  import { AutoSaveState } from './state/autosave.svelte.js';
  import { TaskModeState, type TaskInfo } from './state/task-mode.svelte.js';
  import { pushUndoForType } from './utils/push-undo.svelte.js';
  import { createDataLoader } from './data-loader.js';
  import DraftRecoveryBanner from './components/DraftRecoveryBanner.svelte';
  import LabelTextDialog from './components/LabelTextDialog.svelte';
  import CreateAnnotationBar from './components/CreateAnnotationBar.svelte';
  import TaskPanel from './components/TaskPanel.svelte';
  import TaskSubmitDialog from './components/TaskSubmitDialog.svelte';

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
  const taskMode = new TaskModeState();

  // Provide via context
  setTimelineState(timeline);
  setAnnotationDataState(annotations);
  setSessionState(session);
  setEditorState(editor);
  setTaskModeState(taskMode);

  // Auto-save: wraps tRPC save mutation for annotation persistence
  const autosave = new AutoSaveState(editor, props.videoId, async (videoId, type, data, edits) => {
    await trpc.annotations.save.mutate({
      videoId,
      type: type as AnnotationSetType,
      data,
      edits: edits.map((e) => ({
        editType: e.editType,
        targetIndex: e.targetIndex,
        beforeState: e.beforeState,
        afterState: e.afterState,
      })),
    });
  });

  // Check for existing draft on mount
  let pendingDraft = $state(AutoSaveState.loadDraft(props.videoId));

  // Theme-aware palette for canvas draw functions
  const theme = getTheme();
  let prefersDark = $state(browser ? window.matchMedia('(prefers-color-scheme: dark)').matches : true);
  // matchMedia listener is set up in onMount with cleanup

  const isDark = $derived(
    theme.value === 'dark' || (theme.value === 'system' && prefersDark)
  );
  const palette = $derived(isDark ? PALETTE_DARK : PALETTE_LIGHT);

  // tRPC client — initialized in onMount to avoid SSR fetch warnings
  let supabase: ReturnType<typeof createSupabaseBrowserClient>;
  let trpc: ReturnType<typeof createTRPCClientInstance>;
  let dataLoader: ReturnType<typeof createDataLoader>;

  // Component refs
  let videoPlayer = $state<VideoPlayer>();
  let timelineContainerEl: HTMLDivElement;
  let labelColumnEl: HTMLDivElement;
  let loadError = $state<string | null>(null);

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
    if (annotations.waveform) {
      drawWaveform(ctx, w, h, vp,
        new Float32Array(annotations.waveform.peaks_l),
        annotations.waveform.peaks_r ? new Float32Array(annotations.waveform.peaks_r) : null,
        annotations.waveform.sample_rate,
        palette,
        session.normalized ? annotations.waveformMax : undefined);
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

  // --- Transcription LOD: segment-level aggregation when zoomed out ---
  const transcriptionSegments = $derived.by(() => {
    if (!annotations.transcription?.data) return [];
    return groupWordsBySegment(annotations.transcription.data);
  });

  const useSegmentLOD = $derived.by(() => {
    const words = annotations.transcription?.data;
    if (!words || words.length < 2) return false;
    const avgDuration = (words[words.length - 1].time_range.end - words[0].time_range.start) / words.length;
    return avgDuration * timeline.zoom < 8;
  });

  function segmentBlockClass(item: TranscriptionSegment): string {
    return item.speaker === 'SPEAKER_00' ? 'block-speaker-0' : 'block-speaker-1';
  }

  function segmentBlockLabel(item: TranscriptionSegment): string {
    return item.text;
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

    pushUndoForType(editor, 'userLabels');
    const beforeSnapshot = structuredClone($state.snapshot(editor.userLabels));
    const updated = [...editor.userLabels];
    updated[idx] = { ...updated[idx], text };
    editor.userLabels = updated;
    editor.recordEdit('userLabels', {
      editType: 'classify',
      targetIndex: idx,
      beforeState: beforeSnapshot,
      afterState: structuredClone($state.snapshot(updated)),
    });
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
  async function toggleEditMode() {
    if (editor.editing) {
      // Save pending changes before exiting
      if (editor.hasChanges) {
        await autosave.saveNow();
      }

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
  function applyOperation(
    type: EditableType,
    newArray: unknown[],
    editType: EditType,
    targetIndex: number | null = null,
  ) {
    const beforeState = editor[type];
    const beforeSnapshot = beforeState ? structuredClone($state.snapshot(beforeState)) : null;
    (editor as unknown as Record<string, unknown>)[type] = newArray;
    editor.recordEdit(type, {
      editType,
      targetIndex,
      beforeState: beforeSnapshot,
      afterState: structuredClone($state.snapshot(newArray)),
    });
    if (taskMode.active) taskMode.recordEdit();
    editor.lastEditedType = type;
    editor.markDirty(type);
  }

  function deleteSelected() {
    if (!editor.hasSelection || editor.selectedType === null || editor.selectedIndex === null) return;
    const type = editor.selectedType;
    const idx = editor.selectedIndex;
    const arr = editor[type];
    if (!arr || idx >= arr.length) return;

    pushUndoForType(editor, type);
    applyOperation(type, deleteAnnotation(arr as unknown[], idx), 'delete', idx);
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

    pushUndoForType(editor, type);
    applyOperation(type, splitAnnotation(arr as { time_range: { start: number; end: number } }[], idx, playhead), 'split', idx);
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
      pushUndoForType(editor, type);
      applyOperation(type, mergeAnnotations(mergeArr, idx, idx + 1), 'merge', idx);
    } else if (idx > 0) {
      pushUndoForType(editor, type);
      applyOperation(type, mergeAnnotations(mergeArr, idx - 1, idx), 'merge', idx - 1);
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
  let showSubmitDialog = $state(false);
  let coverageErrors = $state<string[]>([]);

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

    // Ctrl/Cmd+E — toggle edit mode (disabled in task mode — always editing)
    if (mod && e.code === 'KeyE') {
      e.preventDefault();
      if (!taskMode.active) toggleEditMode();
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
      case 'KeyF':
        e.preventDefault();
        if (annotations.facialTracking?.metadata?.mesh_topology) {
          session.meshOverlayVisible = !session.meshOverlayVisible;
          if (!session.meshOverlayVisible) session.meshVideoHidden = false;
        }
        break;
      case 'KeyV':
        if (session.meshOverlayVisible) {
          e.preventDefault();
          session.meshVideoHidden = !session.meshVideoHidden;
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (editor.editing && editor.hasSelection) {
          e.preventDefault();
          if (taskMode.active && !taskMode.isOperationAllowed('delete')) break;
          if (taskMode.active && editor.selectedArray && editor.selectedIndex !== null) {
            const sel = editor.selectedArray[editor.selectedIndex];
            if (sel && taskMode.isTimeLocked(sel.time_range)) break;
          }
          deleteSelected();
        }
        break;
      case 'KeyS':
        if (editor.editing && editor.hasSelection) {
          e.preventDefault();
          if (taskMode.active && !taskMode.isOperationAllowed('split')) break;
          if (taskMode.active && editor.selectedArray && editor.selectedIndex !== null) {
            const sel = editor.selectedArray[editor.selectedIndex];
            if (sel && taskMode.isTimeLocked(sel.time_range)) break;
          }
          splitSelected();
        }
        break;
      case 'KeyM':
        if (editor.editing && editor.hasSelection) {
          e.preventDefault();
          if (taskMode.active && !taskMode.isOperationAllowed('merge')) break;
          if (taskMode.active && editor.selectedArray && editor.selectedIndex !== null) {
            const sel = editor.selectedArray[editor.selectedIndex];
            if (sel && taskMode.isTimeLocked(sel.time_range)) break;
          }
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
          } else if (!taskMode.active) {
            // In task mode, can't exit edit mode via Escape
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
  // Track dirtyVersion (monotonic counter) instead of hasChanges boolean, so each
  // markDirty() call re-triggers the effect even when hasChanges was already true.
  $effect(() => {
    const _version = editor.dirtyVersion;
    if (editor.hasChanges) {
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

  // --- Task mode ---
  async function initTaskMode() {
    if (!props.taskId) return;
    try {
      const task = await trpc.tasks.get.query({ taskId: props.taskId });
      if (!task) return;

      const taskInfo: TaskInfo = {
        id: task.id,
        videoId: task.videoId,
        taskType: task.taskType,
        status: task.status,
        constraints: task.constraints as TaskInfo['constraints'],
        reviewNotes: task.reviewNotes,
        reviewResult: task.reviewResult,
      };

      taskMode.activate(taskInfo);

      // Auto-enter edit mode
      if (!editor.editing) {
        editor.enterEditMode(annotations);
      }

      // Auto-start if assigned
      if (task.status === 'assigned') {
        await trpc.tasks.start.mutate({ taskId: props.taskId });
      }
    } catch (e) {
      console.error('[viewer] Failed to init task mode:', e);
    }
  }

  async function handleTaskSubmit() {
    // Force save current edits
    await autosave.saveNow();

    // Coverage validation for states
    if (taskMode.constraints?.editableTypes.includes('state') && editor.states) {
      const coverage = validateCoverage(editor.states, timeline.duration);
      if (!coverage.valid) {
        coverageErrors = coverage.errors;
        showSubmitDialog = true;
        return;
      }
    }

    coverageErrors = [];
    showSubmitDialog = true;
  }

  async function confirmSubmit() {
    if (!props.taskId) return;
    try {
      await trpc.tasks.submit.mutate({
        taskId: props.taskId,
        editCount: taskMode.editCount,
        timeSpentSecs: Math.round(taskMode.elapsedSecs),
      });
      taskMode.markSubmitted();
      showSubmitDialog = false;
    } catch (e) {
      console.error('[viewer] Submit failed:', e);
    }
  }

  // --- onMount: observers, listeners, data loading, cleanup ---
  onMount(() => {
    // ResizeObserver for timeline container
    let observer: ResizeObserver | undefined;
    if (timelineContainerEl) {
      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          timeline.containerWidth = entry.contentRect.width;
        }
      });
      observer.observe(timelineContainerEl);

      // #3: Imperative wheel handler (passive: false so preventDefault works)
      timelineContainerEl.addEventListener('wheel', handleWheel, { passive: false });
    }

    // #4: matchMedia listener with cleanup
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    function handleMediaChange(e: MediaQueryListEvent) {
      prefersDark = e.matches;
    }
    mediaQuery.addEventListener('change', handleMediaChange);

    // #15: beforeunload — save on page close
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (editor.editing && editor.hasChanges) {
        autosave.saveNow(); // fire-and-forget
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Initialize browser-only clients (avoids SSR fetch warnings)
    supabase = createSupabaseBrowserClient();
    trpc = createTRPCClientInstance(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });
    dataLoader = createDataLoader({ trpc, annotations, timeline, session, videoId: props.videoId });

    // Load data
    loadViewerData();

    return () => {
      observer?.disconnect();
      if (timelineContainerEl) {
        timelineContainerEl.removeEventListener('wheel', handleWheel);
      }
      mediaQuery.removeEventListener('change', handleMediaChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      dataLoader.dispose();
      autosave.dispose();
      taskMode.dispose();
    };
  });

  // --- Data loading (delegated to data-loader.ts) ---
  async function loadViewerData() {
    try {
      await dataLoader.loadViewerData();

      // Init task mode after all data is loaded
      if (props.taskId) {
        await initTaskMode();
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load viewer data';
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="viewer-theme h-screen w-screen flex flex-col overflow-hidden" role="region" aria-label="Timeline">
  <ViewerHeader onTogglePlay={togglePlay} onSeek={seekTo} onTogglePip={togglePip} onToggleEditMode={toggleEditMode} onTaskSubmit={handleTaskSubmit} {autosave} taskMode={taskMode.active ? taskMode : null} {showShortcutsHelp} onToggleShortcutsHelp={() => showShortcutsHelp = !showShortcutsHelp} />

  {#if loadError}
    <div class="px-4 py-2 bg-red-900/30 text-red-400 text-sm border-b border-red-800/50">
      {loadError}
    </div>
  {/if}

  {#if pendingDraft}
    <DraftRecoveryBanner
      draft={pendingDraft}
      isStale={annotations.latestEditTimestamp !== null && pendingDraft.savedAt < annotations.latestEditTimestamp}
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
        {#if taskMode.active}
          <TaskPanel {taskMode} onSubmit={handleTaskSubmit} />
        {:else}
          <InspectorPanel />
        {/if}
      </div>
    </div>

    <!-- Right panel: Timeline (two-column layout) -->
    <div class="flex-1 flex min-w-0">
      <!-- Fixed label column -->
      <div
        bind:this={labelColumnEl}
        class="shrink-0 overflow-hidden bg-viewer-surface"
        style="width: 120px"
        aria-label="Track labels"
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
        aria-label="Annotation tracks"
      >
        <div class="relative" style="width: {timelineWidth}px; min-width: 100%;">
          <!-- Playhead (absolute position: x=0 is time=0) -->
          <Playhead />

          <!-- Locked region overlays (task mode) -->
          {#if taskMode.active}
            {#each taskMode.lockedTimeRanges as range}
              <div
                class="locked-region-overlay absolute top-0 bottom-0 z-20"
                style="left: {timeline.timeToPx(range.start)}px; width: {timeline.timeToPx(range.end - range.start)}px"
              ></div>
            {/each}
          {/if}

          <!-- Ruler -->
          <TrackContent height={32}>
            <CanvasTrack height={32} draw={drawRulerTrack} onScrub={handleScrub} />
          </TrackContent>

          <!-- Waveform -->
          <TrackContent height={64}>
            {#if annotations.waveform}
              <CanvasTrack height={64} draw={drawWaveformTrack} onScrub={handleScrub} />
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <span class="text-viewer-sm text-viewer-text-dim">
                  {annotations.loadStatus.waveform === 'loading' ? 'Loading waveform...' : ''}
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
                {#if useSegmentLOD}
                  <DOMTrack
                    data={transcriptionSegments}
                    getStart={getTimeRangeStart}
                    getEnd={getTimeRangeEnd}
                    blockClass={segmentBlockClass}
                    blockLabel={segmentBlockLabel}
                    onBlockClick={(item) => handleBlockClick(item as unknown as Record<string, unknown>)}
                  />
                {:else}
                  <DOMTrack
                    data={annotations.transcription!.data}
                    getStart={getTimeRangeStart}
                    getEnd={getTimeRangeEnd}
                    blockClass={transcriptionBlockClass}
                    blockLabel={transcriptionBlockLabel}
                    onBlockClick={(item) => handleBlockClick(item as unknown as Record<string, unknown>)}
                  />
                {/if}
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

  {#if showSubmitDialog}
    <TaskSubmitDialog
      editCount={taskMode.editCount}
      elapsedSecs={taskMode.elapsedSecs}
      {coverageErrors}
      onConfirm={confirmSubmit}
      onCancel={() => showSubmitDialog = false}
    />
  {/if}
</div>
