<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { createSupabaseBrowserClient } from '$lib/supabase';
  import { createTRPCClientInstance } from '$lib/trpc';
  import type {
    SpeechWord,
    UserLabel,
    EditType,
    AnnotationSetType,
    StateAnnotation,
    IntentAnnotation,
    BackchannelAnnotation,
    TimeRange,
  } from '@annotation/shared';
  import { groupWordsBySegment, type TranscriptionSegment } from './utils/group-words.js';
  import { binarySearchStart, binarySearchEnd } from './utils/binary-search.js';
  import type { Viewport } from './types.js';

  import { TimelineState } from './state/timeline.svelte.js';
  import { AnnotationDataState } from './state/annotation-data.svelte.js';
  import { SessionState } from './state/session.svelte.js';
  import { EditorState, isReclassifiable, type EditableType } from './state/editor.svelte.js';
  import {
    setTimelineState,
    setAnnotationDataState,
    setSessionState,
    setEditorState,
    setTaskModeState,
  } from './context.js';
  import {
    GROUP_HEADER_HEIGHT,
    RULER_HEIGHT,
    type TrackConfig,
    type TrackGroup as TrackGroupId,
    type TrackId,
    type ViewerMode,
  } from './state/tracks.svelte.js';

  import ViewerHeader from './ViewerHeader.svelte';
  import VideoPlayer from './VideoPlayer.svelte';
  import InspectorPanel from './InspectorPanel.svelte';
  import Playhead from './Playhead.svelte';
  import CanvasTrack from './tracks/CanvasTrack.svelte';
  import DOMTrack from './tracks/DOMTrack.svelte';
  import EditableDOMTrack from './tracks/EditableDOMTrack.svelte';
  import TrackLabel from './tracks/TrackLabel.svelte';
  import TrackGroup from './tracks/TrackGroup.svelte';
  import TrackContent from './tracks/TrackContent.svelte';
  import {
    drawRuler,
    drawVad,
    drawDiarization,
    drawMouthEnergy,
    drawWaveform,
    drawHeadPose,
    DEFAULT_POSE_RANGE,
  } from './tracks/draw-functions.js';
  import { PALETTE_DARK, PALETTE_LIGHT } from './viewer-palette.js';
  import { browser } from '$app/environment';

  import { deleteAnnotation, splitAnnotation, mergeAnnotations } from './editing/operations.js';
  import { validateCoverage, checkContiguity } from './editing/time-validation.js';
  import { AutoSaveState, EDITABLE_TO_ANNOTATION_TYPE } from './state/autosave.svelte.js';
  import { TaskModeState, taskAccessFor, type TaskInfo } from './state/task-mode.svelte.js';
  import { createDataLoader, loadFixture } from './data-loader.js';
  import type { ViewerFixture } from './fixtures/generate.js';
  import {
    buildReviewQueue,
    getConfidence,
    getItemLabel,
    getProvenance,
    isHumanReviewed,
    isLowConfidence,
    nextReviewItem,
    prevReviewItem,
    queueKeyFor,
    reviewedBaselineKeys,
    mergeQueueRows,
    locateQueueItem,
    stampExtentEdit,
    withReview,
    type ReviewableAnnotation,
    type ReviewFilter,
    type ReviewItem,
    type ReviewSelectVia,
  } from './review.js';

  import DraftRecoveryBanner from './components/DraftRecoveryBanner.svelte';
  import LabelTextDialog from './components/LabelTextDialog.svelte';
  import EditToolbar from './components/EditToolbar.svelte';
  import TaskToolbar from './components/TaskToolbar.svelte';
  import TaskPanel, { type TaskDetails } from './components/TaskPanel.svelte';
  import TaskSubmitDialog from './components/TaskSubmitDialog.svelte';
  import ReviewQueue from './components/ReviewQueue.svelte';
  import ClassifyDialog, { type ClassifyResult } from './components/ClassifyDialog.svelte';
  import ContextMenu, { blockMenuItems, type BlockMenuAction, type MenuEntry } from './components/ContextMenu.svelte';
  import TimelineOverview from './components/TimelineOverview.svelte';
  import ViewerStatusBar, { type StatusSelection } from './components/ViewerStatusBar.svelte';

  import './viewer.css';

  interface Props {
    videoId: string;
    taskId?: string;
    /**
     * Synthetic data for /dev/viewer. Skips Supabase, tRPC and the data
     * loader, fills the state directly, and keeps autosave in memory.
     */
    fixture?: ViewerFixture;
    /** Initial playhead position in seconds (?t=) */
    initialTime?: number;
  }

  const props: Props = $props();

  /** Label column width (timeline-screen.html) */
  const LABEL_WIDTH = 184;
  /** Fixture zoom: the design's 24 s window over a 1736 px track (px/s) */
  const FIXTURE_ZOOM = 72;
  /** Where the fixture's initial playhead sits in the window (design: 53.6 in 42–66) */
  const FIXTURE_PLAYHEAD_AT = 0.48;

  // Everything that depends on the fixture is fixed at mount
  const fixture = untrack(() => props.fixture);
  const videoId = untrack(() => props.videoId);
  const taskId = untrack(() => props.taskId);

  // Create state
  const timeline = new TimelineState();
  const annotations = new AnnotationDataState();
  const session = new SessionState(videoId);
  const editor = new EditorState();
  const taskMode = new TaskModeState();
  const trackLayout = session.tracks;

  // Provide via context
  setTimelineState(timeline);
  setAnnotationDataState(annotations);
  setSessionState(session);
  setEditorState(editor);
  setTaskModeState(taskMode);

  // tRPC client, initialized in onMount to avoid SSR fetch warnings (never in fixture mode)
  let supabase: ReturnType<typeof createSupabaseBrowserClient> | null = null;
  let trpc: ReturnType<typeof createTRPCClientInstance> | null = null;
  let dataLoader: ReturnType<typeof createDataLoader> | null = null;

  /** Signed-in user (review.by stamps, track layout persistence) */
  let userId = $state<string | null>(null);

  // Auto-save: tRPC save mutation, or an in-memory no-op for the fixture
  const autosave = new AutoSaveState(
    editor,
    videoId,
    async (vid, type, data, edits) => {
      if (fixture || !trpc) return;
      await trpc.annotations.save.mutate({
        videoId: vid,
        type: type as AnnotationSetType,
        data,
        // Task mode: the server checks the task (in progress, assigned to the
        // caller, editableTypes, allowedOperations) and lets annotators save.
        // Only while the task is editable: a read-only task never edits, and a
        // ?taskId= link alone (someone else's task) must not tag saves.
        ...(taskId && taskMode.editable ? { taskId } : {}),
        edits: edits.map((e) => ({
          editType: e.editType,
          targetIndex: e.targetIndex,
          beforeState: e.beforeState,
          afterState: e.afterState,
        })),
      });
    },
    { persistDrafts: !fixture },
  );

  // Check for an existing draft on mount (never for the fixture)
  let pendingDraft = $state(fixture ? null : AutoSaveState.loadDraft(videoId));

  // Theme-aware palette for canvas draw functions. Read from the `.dark` class
  // on <html> (kept current by a MutationObserver in onMount), so the canvas
  // always matches the DOM whatever set the class: theme store, app.html, /dev/viewer.
  let isDark = $state(browser && document.documentElement.classList.contains('dark'));
  const palette = $derived(isDark ? PALETTE_DARK : PALETTE_LIGHT);

  // Component refs
  let videoPlayer = $state<VideoPlayer>();
  let editToolbar = $state<EditToolbar>();
  let timelineContainerEl: HTMLDivElement;
  let rootEl: HTMLDivElement;
  let loadError = $state<string | null>(null);

  // Dialog / menu state
  let showClassifyDialog = $state(false);
  let showLabelTextDialog = $state(false);
  let labelTextDialogCurrent = $state('');
  let showShortcutsHelp = $state(false);
  let showSubmitDialog = $state(false);
  let coverageErrors = $state<string[]>([]);
  let coverageGaps = $state<TimeRange[]>([]);
  let contextMenu = $state<{ x: number; y: number; type: EditableType; index: number } | null>(null);
  let reviewFilter = $state<ReviewFilter>('all');

  const overlayOpen = $derived(
    showClassifyDialog || showLabelTextDialog || showShortcutsHelp || showSubmitDialog || contextMenu !== null,
  );

  // --- Mode ---
  const viewerMode: ViewerMode = $derived(taskMode.active ? 'task' : editor.editing ? 'edit' : 'view');

  /** annotation_set type → editor array, for task constraints */
  const SET_TO_EDITABLE: Partial<Record<AnnotationSetType, EditableType>> = {
    state: 'states',
    intent: 'intents',
    transcription: 'transcription',
    backchannel: 'backchannels',
    user_labels: 'userLabels',
  };

  const taskEditableTypes = $derived(
    (taskMode.constraints?.editableTypes ?? [])
      .map((t) => SET_TO_EDITABLE[t])
      .filter((t): t is EditableType => t !== undefined),
  );

  // Track layout follows the mode (task mode: task heights, non-editable tracks collapsed)
  $effect(() => {
    const mode = viewerMode;
    const editableTypes = taskEditableTypes;
    untrack(() => trackLayout.setMode(mode, { editableTypes }));
  });

  // --- Track availability (data, or a loading / error placeholder) ---
  function isTrackVisible(status: string): boolean {
    return status === 'loaded' || status === 'loading' || status === 'error';
  }

  const hasUserLabels = $derived(
    (editor.editing && editor.userLabels !== null) ||
      (!editor.editing && !!annotations.userLabels?.data?.length),
  );

  const availableTracks = $derived.by(() => {
    const s = annotations.loadStatus;
    const ids = new Set<TrackId>(['waveform']);
    if (isTrackVisible(s.vad)) ids.add('vad');
    if (annotations.diarization || isTrackVisible(s.diarization)) ids.add('diarization');
    if (isTrackVisible(s.mouth_energy)) ids.add('mouth_energy');
    if (isTrackVisible(s.facial_tracking)) ids.add('head_pose');
    if (annotations.transcription || isTrackVisible(s.transcription)) ids.add('transcription');
    if (editor.states || annotations.stateAnnotation || isTrackVisible(s.state_annotation)) ids.add('states');
    if (editor.intents || annotations.intentClassification || isTrackVisible(s.intent_classification)) ids.add('intents');
    if (editor.backchannels?.length || annotations.backchannel?.data?.length) ids.add('backchannels');
    if (hasUserLabels) ids.add('user_labels');
    return ids;
  });

  $effect(() => {
    trackLayout.available = availableTracks;
  });

  /** Available tracks per group (group header count, "N hidden" when collapsed) */
  function groupCount(group: TrackGroupId): number {
    return trackLayout.tracks.filter((t) => t.group === group && availableTracks.has(t.id)).length;
  }

  // Total timeline width in pixels
  const timelineWidth = $derived(timeline.timeToPx(timeline.duration));

  // --- Current data: editor arrays while editing, else the loaded annotations ---
  const currentStates = $derived(editor.states ?? annotations.stateAnnotation?.data ?? null);
  const currentIntents = $derived(editor.intents ?? annotations.intentClassification?.data ?? null);
  const currentWords = $derived(editor.transcription ?? annotations.transcription?.data ?? null);
  const currentBackchannels = $derived(editor.backchannels ?? annotations.backchannel?.data ?? null);

  // --- Draw function wrappers that capture annotation data + palette ---
  function drawRulerTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    drawRuler(ctx, w, h, vp, palette);
  }

  /**
   * Peak arrays as Float32Arrays, built once per load. `annotations.waveform`
   * is `$state.raw`, so this derived depends on the object, not on ~50k
   * elements, and a scroll redraw reads two typed arrays instead of copying
   * the peaks every frame.
   */
  const waveformPeaks = $derived.by(() => {
    const w = annotations.waveform;
    if (!w) return null;
    return {
      l: new Float32Array(w.peaks_l),
      r: w.peaks_r ? new Float32Array(w.peaks_r) : null,
      sampleRate: w.sample_rate,
    };
  });

  function drawWaveformTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    const peaks = waveformPeaks;
    if (peaks) {
      drawWaveform(ctx, w, h, vp, peaks.l, peaks.r, peaks.sampleRate, palette,
        session.normalized ? annotations.waveformMax : undefined);
    }
  }

  function drawVadTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.vad?.frames) {
      drawVad(ctx, w, h, vp, annotations.vad.frames, palette,
        session.normalized ? annotations.vadMax : undefined);
    }
  }

  function drawDiarizationTrack(ctx: CanvasRenderingContext2D, w: number, h: number, vp: Viewport) {
    if (annotations.diarization?.data) {
      drawDiarization(ctx, w, h, vp, annotations.diarization.data, palette);
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

  // --- Block helpers (hue class only; the track adds `blk`) ---
  function speakerHue(speaker: string): string {
    return speaker === 'SPEAKER_00' ? 'hue-spk-0' : 'hue-spk-1';
  }
  const wordBlockClass = (item: SpeechWord) => speakerHue(item.speech.speaker);
  const wordBlockLabel = (item: SpeechWord) => item.speech.word;
  const segmentBlockClass = (item: TranscriptionSegment) => speakerHue(item.speaker);
  const segmentBlockLabel = (item: TranscriptionSegment) => item.text;
  const stateBlockClass = (item: StateAnnotation) =>
    item.category === 'expression.state.speaking' ? 'hue-speaking' : 'hue-listening';
  const stateBlockLabel = (item: StateAnnotation) => item.category.replace('expression.state.', '');
  const intentBlockClass = (item: IntentAnnotation) => `hue-intent-${item.intent_classification.intent}`;
  const intentBlockLabel = (item: IntentAnnotation) => item.intent_classification.intent;
  const backchannelBlockClass = () => 'hue-backchannel';
  const backchannelBlockLabel = (item: BackchannelAnnotation) => item.backchannel.type;
  const userLabelBlockClass = () => 'hue-label';
  const userLabelBlockLabel = (item: UserLabel) => item.text;

  function getTimeRangeStart(item: { time_range: { start: number } }): number {
    return item.time_range.start;
  }

  function getTimeRangeEnd(item: { time_range: { end: number } }): number {
    return item.time_range.end;
  }

  // Review helpers typed for the generic tracks
  const sourceOf = (item: ReviewableAnnotation) => getProvenance(item);
  const lowConfOf = (item: ReviewableAnnotation) => isLowConfidence(item);
  const confOf = (item: ReviewableAnnotation) => getConfidence(item);

  // View-mode selection (DOMTrack clicks) drives the Inspector
  function handleBlockClick(item: unknown) {
    session.selectedAnnotation = item as Record<string, unknown>;
  }
  const isViewSelected = (item: unknown) => session.selectedAnnotation === item;
  const isItemLocked = (item: { time_range: TimeRange }) =>
    taskMode.active && taskMode.isTimeLocked(item.time_range);

  // --- Transcription LOD: segment-level aggregation when zoomed out ---
  const transcriptionSegments = $derived.by(() => (currentWords ? groupWordsBySegment(currentWords) : []));

  const useSegmentLOD = $derived.by(() => {
    const words = currentWords;
    if (!words || words.length < 2) return false;
    const avgDuration = (words[words.length - 1].time_range.end - words[0].time_range.start) / words.length;
    return avgDuration * timeline.zoom < 8;
  });

  // --- Track label meta ---
  /** Low-confidence items in the current window (label "N < .60") */
  function lowConfInView(items: readonly (IntentAnnotation | SpeechWord)[] | null): number {
    if (!items || items.length === 0) return 0;
    const list = items as (IntentAnnotation | SpeechWord)[];
    const from = Math.max(0, binarySearchStart(list, timeline.viewStartTime));
    const to = Math.min(list.length - 1, binarySearchEnd(list, timeline.viewEndTime));
    let n = 0;
    for (let i = from; i <= to; i++) if (isLowConfidence(list[i])) n++;
    return n;
  }

  const lowConfWords = $derived(lowConfInView(currentWords));
  const lowConfIntents = $derived(lowConfInView(currentIntents));

  const statesCoverage = $derived.by(() => {
    if (!currentStates || timeline.duration <= 0) return null;
    let covered = 0;
    for (const s of currentStates) covered += Math.max(0, s.time_range.end - s.time_range.start);
    return Math.min(100, Math.round((covered / timeline.duration) * 100));
  });

  const poseRangeLabel = $derived(
    session.normalized
      ? `${Math.round(annotations.headPoseMin)}° … ${Math.round(annotations.headPoseMax)}°`
      : `±${DEFAULT_POSE_RANGE}°`,
  );

  /** Editable in the current mode (pen icon + teal wash on the label) */
  function isTrackEditable(t: TrackConfig): boolean {
    if (!t.editableType || !editor.editing) return false;
    if (taskMode.active) return taskMode.isTypeEditable(EDITABLE_TO_ANNOTATION_TYPE[t.editableType]);
    return true;
  }

  function trackMeta(t: TrackConfig): string | undefined {
    switch (t.id) {
      case 'vad': return 'thr 0.50';
      case 'mouth_energy': return 'face 0';
      case 'states':
        if (taskMode.active && !isTrackEditable(t)) return 'read-only';
        return statesCoverage != null ? `coverage ${statesCoverage}%` : undefined;
      case 'backchannels':
      case 'user_labels':
        return taskMode.active && !isTrackEditable(t) ? 'read-only' : undefined;
      default: return undefined;
    }
  }

  function trackLowConf(t: TrackConfig): number | null {
    if (t.id === 'transcription') return currentWords ? lowConfWords : null;
    if (t.id === 'intents') return currentIntents ? lowConfIntents : null;
    return null;
  }

  // --- User label dialog ---
  function handleLabelDoubleClick(_item: UserLabel, index: number) {
    if (taskMode.active && !canOperate('classify')) return;
    const labels = editor.userLabels;
    if (labels && index < labels.length) {
      labelTextDialogCurrent = labels[index].text;
      showLabelTextDialog = true;
    }
  }

  function handleLabelTextConfirm(text: string) {
    showLabelTextDialog = false;
    if (!editor.userLabels || editor.selectedType !== 'userLabels' || editor.selectedIndex === null) return;
    const idx = editor.selectedIndex;
    if (idx >= editor.userLabels.length) return;

    editor.pushUndo('userLabels');
    const updated = structuredClone($state.snapshot(editor.userLabels)) as UserLabel[];
    updated[idx] = { ...updated[idx], text };
    applyOperation('userLabels', updated, 'classify', idx);
  }

  // --- Playback / seeking ---
  function clampTime(time: number): number {
    return Math.max(0, Math.min(time, timeline.duration));
  }

  function seekTo(time: number) {
    const t = clampTime(time);
    if (videoPlayer) videoPlayer.seek(t);
    else timeline.currentTime = t;
  }

  function handleScrub(time: number) {
    seekTo(time);
  }

  function togglePlay() {
    videoPlayer?.toggle();
  }

  function togglePip() {
    videoPlayer?.togglePip();
  }

  // --- Scrolling ---
  function handleTimelineScroll() {
    if (timelineContainerEl) timeline.scrollLeft = timelineContainerEl.scrollLeft;
  }

  function scrollToTime(time: number) {
    if (!timelineContainerEl) return;
    timelineContainerEl.scrollLeft = Math.max(0, Math.min(timeline.timeToPx(time), timeline.maxScrollLeft));
  }

  /** Scroll a range into view when it is (partly) outside the window */
  function revealRange(start: number, end: number = start) {
    if (start >= timeline.viewStartTime && end <= timeline.viewEndTime) return;
    const windowSecs = timeline.containerWidth / timeline.zoom;
    scrollToTime(start - windowSecs * 0.25);
  }

  // Cmd/Ctrl+wheel zoom (proportional)
  function handleWheel(e: WheelEvent) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      timeline.zoom = Math.max(0.5, Math.min(100, timeline.zoom * factor));
    }
  }

  // --- Edit mode ---
  /** Write the editor arrays back into the loaded data so view mode shows this session's edits. */
  function writeBackEdits() {
    const snap = <T,>(arr: T[]) => structuredClone($state.snapshot(arr)) as T[];
    const humanMeta = () => ({
      source_file: '',
      format_version: '1.0',
      created_timestamp: new Date().toISOString(),
      total_secs: timeline.duration,
      algorithm: { name: 'human', model: 'manual', version: '1.0', processing_time: 0 },
    });
    if (editor.states && annotations.stateAnnotation) {
      annotations.stateAnnotation = { ...annotations.stateAnnotation, data: snap(editor.states) };
    }
    if (editor.intents && annotations.intentClassification) {
      annotations.intentClassification = { ...annotations.intentClassification, data: snap(editor.intents) };
    }
    if (editor.transcription && annotations.transcription) {
      annotations.transcription = { ...annotations.transcription, data: snap(editor.transcription) };
    }
    if (editor.backchannels) {
      annotations.backchannel = editor.backchannels.length
        ? { metadata: annotations.backchannel?.metadata ?? humanMeta(), data: snap(editor.backchannels) }
        : null;
    }
    if (editor.userLabels) {
      annotations.userLabels = editor.userLabels.length
        ? { metadata: annotations.userLabels?.metadata ?? humanMeta(), data: snap(editor.userLabels) }
        : null;
    }
  }

  async function toggleEditMode() {
    if (taskMode.active) return;
    if (editor.editing) {
      if (editor.hasChanges) await autosave.saveNow();
      writeBackEdits();
      editor.exitEditMode();
    } else {
      session.selectedAnnotation = null;
      editor.enterEditMode(annotations);
    }
  }

  // --- Selection helpers ---
  interface SelectedInfo {
    type: EditableType;
    index: number;
    item: ReviewableAnnotation & { time_range: TimeRange };
    array: { time_range: TimeRange }[];
  }

  const selected = $derived.by((): SelectedInfo | null => {
    const type = editor.selectedType;
    const index = editor.selectedIndex;
    if (!editor.editing || type === null || index === null) return null;
    const array = editor[type] as { time_range: TimeRange }[] | null;
    const item = array?.[index] as SelectedInfo['item'] | undefined;
    if (!array || !item) return null;
    return { type, index, item, array };
  });

  /** Whether `op` may run on the selection (edit mode, task constraints, locked ranges) */
  function canOperate(op: EditType, sel: SelectedInfo | null = selected): sel is SelectedInfo {
    if (!sel) return false;
    if (!taskMode.active) return true;
    return (
      taskMode.isTypeEditable(EDITABLE_TO_ANNOTATION_TYPE[sel.type]) &&
      taskMode.isOperationAllowed(op) &&
      !taskMode.isTimeLocked(sel.item.time_range)
    );
  }

  // --- Editing operations ---
  function applyOperation(type: EditableType, newArray: unknown[], editType: EditType, targetIndex: number | null = null) {
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
    const sel = selected;
    if (!canOperate('delete', sel)) return;
    editor.pushUndo(sel.type);
    applyOperation(sel.type, deleteAnnotation(sel.array as unknown[], sel.index), 'delete', sel.index);
    editor.deselect();
  }

  /**
   * A split, merge or resize changes an item's extent, so the items it
   * produces are re-stamped `confirmed: false` (human-decided) instead of
   * keeping the old stamp. User labels carry no review stamp.
   */
  function restampExtent(type: EditableType, items: unknown[], indices: number[], from: unknown): unknown[] {
    if (type === 'userLabels') return items;
    const by = userId ?? undefined;
    for (const i of indices) items[i] = stampExtentEdit(items[i] as ReviewableAnnotation, by, from as ReviewableAnnotation);
    return items;
  }

  function splitSelected() {
    const sel = selected;
    if (!canOperate('split', sel)) return;
    const playhead = timeline.currentTime;
    if (playhead <= sel.item.time_range.start + 0.05 || playhead >= sel.item.time_range.end - 0.05) return;
    const plain = $state.snapshot(sel.array) as { time_range: TimeRange }[];
    // Both halves keep the original's review origin
    const next = restampExtent(sel.type, splitAnnotation(plain, sel.index, playhead), [sel.index, sel.index + 1], plain[sel.index]);
    editor.pushUndo(sel.type);
    applyOperation(sel.type, next, 'split', sel.index);
  }

  function mergeSelected() {
    const sel = selected;
    if (!canOperate('merge', sel)) return;
    const { type, index } = sel;
    const plain = $state.snapshot(sel.array) as { time_range: TimeRange }[];
    if (index + 1 < plain.length) {
      editor.pushUndo(type);
      // The merged item keeps the lower item's origin (review.ts reviewedBaselineKeys)
      applyOperation(type, restampExtent(type, mergeAnnotations(plain, index, index + 1), [index], plain[index]), 'merge', index);
    } else if (index > 0) {
      editor.pushUndo(type);
      applyOperation(type, restampExtent(type, mergeAnnotations(plain, index - 1, index), [index - 1], plain[index - 1]), 'merge', index - 1);
      editor.select(type, index - 1);
    }
  }

  /** ↵ / Confirm: accept the selected AI prediction unchanged, then move to the next in review */
  function confirmSelected() {
    const sel = selected;
    if (!canOperate('confirm', sel) || sel.type === 'userLabels') return;
    const key = queueKeyFor(sel.type, sel.item);
    const start = sel.item.time_range.start;
    if (!editor.confirmSelected({ by: userId ?? undefined })) return;
    if (taskMode.active) taskMode.recordEdit();
    const next = nextReviewItem(activeQueue, { time: start, key }, { wrap: false });
    if (next) selectReviewItem(next);
  }

  /** C / Reclassify: ClassifyDialog for states and intents, the text dialog for labels */
  function openReclassify() {
    const sel = selected;
    if (!canOperate('classify', sel) || !isReclassifiable(sel.type)) return;
    if (sel.type === 'userLabels') {
      labelTextDialogCurrent = (sel.item as UserLabel).text;
      showLabelTextDialog = true;
    } else if (sel.type === 'states' || sel.type === 'intents') {
      showClassifyDialog = true;
    }
  }

  function handleClassify(result: ClassifyResult) {
    showClassifyDialog = false;
    const sel = selected;
    if (!canOperate('classify', sel) || result.type !== sel.type) return;
    const category = result.type === 'states' ? result.category : result.intent;
    if (taskMode.active && !taskMode.isCategoryAllowed(category)) return;

    const by = userId ?? undefined;
    const next = structuredClone($state.snapshot(sel.array)) as unknown[];
    // `from`: the pre-edit item, so the stamp keeps (or starts) its review origin
    if (result.type === 'states') {
      const item = next[sel.index] as StateAnnotation;
      next[sel.index] = withReview({ ...item, category: result.category }, { confirmed: false, by, from: item });
    } else {
      const item = next[sel.index] as IntentAnnotation;
      next[sel.index] = withReview(
        {
          ...item,
          intent_classification: {
            ...item.intent_classification,
            intent: result.intent,
            intensity: result.intensity,
            valence: result.valence,
          },
        },
        { confirmed: false, by, from: item },
      );
    }
    editor.pushUndo(sel.type);
    applyOperation(sel.type, next, 'classify', sel.index);
  }

  // --- Review queue ---
  const reviewQueue = $derived(buildReviewQueue({ intents: currentIntents, words: currentWords }));

  /** Queue as loaded, so items reviewed this session stay listed (dimmed, ✓) */
  const baselineQueue = $derived(
    editor.editing
      ? buildReviewQueue({
          intents: annotations.intentClassification?.data,
          words: annotations.transcription?.data,
        })
      : [],
  );

  /**
   * Baseline rows reviewed since load: a current human-reviewed item carries
   * the row's key as `review.origin` (or has it exactly), so a reclassified or
   * resized row keeps its ✓. Keys still open are left out.
   */
  const reviewedQueueKeys = $derived.by(() => {
    if (!editor.editing || baselineQueue.length === 0) return new Set<string>();
    return reviewedBaselineKeys(baselineQueue, { intents: editor.intents, words: editor.transcription }, reviewQueue);
  });

  /** Open rows plus reviewed baseline rows, each key once (ReviewQueue's keyed each) */
  const queueRows = $derived(
    reviewedQueueKeys.size === 0 ? reviewQueue : mergeQueueRows(reviewQueue, baselineQueue, reviewedQueueKeys),
  );

  /**
   * What ⇥ / ↵ walk: the queue, or in task mode only the items the task may
   * act on (its review scope, outside locked ranges). Empty for a task that
   * reviews neither intents nor words.
   */
  const activeQueue = $derived.by(() => {
    if (!taskMode.active) return reviewQueue;
    const scope = taskMode.reviewScope;
    return buildReviewQueue({
      intents: scope.intents ? currentIntents : null,
      words: scope.words ? currentWords : null,
      lockedRanges: taskMode.lockedTimeRanges,
    });
  });

  const selectedQueueKey = $derived.by(() => {
    if (selected && (selected.type === 'intents' || selected.type === 'transcription')) {
      return queueKeyFor(selected.type, selected.item);
    }
    const item = session.selectedAnnotation as ReviewableAnnotation | null;
    if (!editor.editing && item) {
      if ('intent_classification' in item) return queueKeyFor('intents', item);
      if ('speech' in item) return queueKeyFor('transcription', item);
    }
    return null;
  });

  /**
   * Select a queue row: editor selection (edit/task) or Inspector selection
   * (view), then seek + reveal. A pointer click on a row moves focus back to
   * the viewer root so ↵ confirms and ⇥ steps (a focused row or button would
   * keep those keys); keyboard activation leaves focus in the list.
   */
  function selectReviewItem(q: ReviewItem, via: ReviewSelectVia = 'keyboard') {
    if (editor.editing) {
      const arr = editor[q.editableType] as ReviewableAnnotation[] | null;
      if (!arr) return;
      // Same key, else (a reviewed row whose item was reclassified or resized) the item with its origin
      const idx = locateQueueItem(arr, q);
      if (idx < 0) return;
      editor.select(q.editableType, idx);
    } else {
      const list = q.editableType === 'intents' ? annotations.intentClassification?.data : annotations.transcription?.data;
      const item = list?.[q.index];
      if (item) session.selectedAnnotation = item as unknown as Record<string, unknown>;
    }
    seekTo(q.start);
    revealRange(q.start, q.end);
    if (via === 'pointer') rootEl?.focus({ preventScroll: true });
  }

  /**
   * ⇥ / ⇧⇥ on the viewer root: select the next / previous queue item. Focus
   * stays on the root, so the next ⇥ keeps stepping and ↵ confirms. No wrap:
   * at either end of the queue this returns false and Tab keeps its native
   * meaning (focus moves on), so the viewer never traps keyboard focus.
   */
  function stepReview(reverse: boolean): boolean {
    const anchor = { time: timeline.currentTime, key: selectedQueueKey };
    const q = reverse
      ? prevReviewItem(activeQueue, anchor, { wrap: false })
      : nextReviewItem(activeQueue, anchor, { wrap: false });
    if (!q) return false;
    selectReviewItem(q);
    return true;
  }

  // --- Task mode ---
  taskMode.connectReview(() => ({
    current: {
      intents: currentIntents ?? undefined,
      words: currentWords ?? undefined,
      states: currentStates ?? undefined,
      backchannels: currentBackchannels ?? undefined,
    },
    baseline: {
      intents: annotations.intentClassification?.data,
      words: annotations.transcription?.data,
      states: annotations.stateAnnotation?.data,
      backchannels: annotations.backchannel?.data,
    },
  }));

  let taskDetails = $state<TaskDetails | null>(null);
  let taskTitle = $state<string | null>(null);

  /** Short header reference (design "T-0192"); a UUID would crowd the identity group */
  const taskRef = $derived.by(() => {
    const id = taskMode.task?.id;
    if (!id) return null;
    return id.startsWith('T-') ? id : `T-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
  });

  const reviewedLabel = $derived(
    !taskMode.hasReviewScope
      ? 'Items reviewed'
      : taskMode.reviewScope.words && !taskMode.reviewScope.intents
        ? 'Words reviewed'
        : taskMode.reviewScope.intents && !taskMode.reviewScope.words
          ? 'Intents reviewed'
          : 'Items reviewed',
  );

  /**
   * Enter task mode. An editable task opens in edit mode; a read-only one
   * (`readOnlyReason`, see taskAccessFor) keeps the read-only tracks, so
   * nothing is edited or autosaved, and TaskPanel shows the reason.
   */
  function startTask(info: TaskInfo, readOnlyReason: string | null = null) {
    taskMode.activate(info, { readOnlyReason });
    trackLayout.setMode('task', { editableTypes: taskEditableTypes });
    if (taskMode.editable && !editor.editing) {
      session.selectedAnnotation = null;
      editor.enterEditMode(annotations);
    }
  }

  async function initTaskMode() {
    if (!taskId || !trpc) return;
    try {
      const task = await trpc.tasks.get.query({ taskId });
      if (!task) return;

      // Only the assignee works on an assigned or in-progress task; anyone else opens it read-only
      const { data } = (await supabase?.auth.getSession()) ?? { data: null };
      const me = data?.session?.user.id ?? userId;
      const access = taskAccessFor(task, me);
      let status = task.status;
      let readOnlyReason = access.reason;
      if (access.editable && status === 'assigned') {
        try {
          await trpc.tasks.start.mutate({ taskId });
          status = 'in_progress';
        } catch (e) {
          console.error('[viewer] Failed to start task:', e);
          readOnlyReason = 'Read-only: the task could not be started';
        }
      }

      startTask(
        {
          id: task.id,
          videoId: task.videoId,
          taskType: task.taskType,
          status,
          constraints: task.constraints as TaskInfo['constraints'],
          reviewNotes: task.reviewNotes,
          reviewResult: task.reviewResult,
          assignedTo: task.assignedTo,
          assigneeName: task.assigneeName,
        },
        readOnlyReason,
      );
      taskDetails = {
        feedbackAt: task.reviewNotes && task.reviewedAt ? new Date(task.reviewedAt).toISOString().slice(0, 10) : null,
      };
    } catch (e) {
      console.error('[viewer] Failed to init task mode:', e);
    }
  }

  /** Gaps in state coverage (start, internal, end) for the submit dialog */
  function stateCoverageGaps(states: readonly StateAnnotation[]): TimeRange[] {
    if (states.length === 0) return [{ start: 0, end: timeline.duration }];
    const tolerance = 0.1;
    const first = states[0].time_range.start;
    const last = states[states.length - 1].time_range.end;
    return [
      ...(first > tolerance ? [{ start: 0, end: first }] : []),
      ...checkContiguity([...states], tolerance).gaps,
      ...(last < timeline.duration - tolerance ? [{ start: last, end: timeline.duration }] : []),
    ];
  }

  async function handleTaskSubmit() {
    if (!taskMode.editable) return;
    await autosave.saveNow();

    coverageErrors = [];
    coverageGaps = [];
    if (taskMode.constraints?.editableTypes.includes('state') && editor.states) {
      const coverage = validateCoverage(editor.states, timeline.duration);
      if (!coverage.valid) {
        coverageErrors = coverage.errors;
        coverageGaps = stateCoverageGaps(editor.states);
      }
    }
    showSubmitDialog = true;
  }

  async function confirmSubmit() {
    // States must partition the video: the dialog disables Submit, and this guards ⌘↵ too
    if (coverageErrors.length > 0 || coverageGaps.length > 0) return;
    if (fixture) {
      finishSubmit();
      return;
    }
    if (!taskId || !trpc) return;
    try {
      // Anything edited while the dialog was open goes out with the task id first
      if (editor.hasChanges) await autosave.saveNow();
      await trpc.tasks.submit.mutate({
        taskId,
        editCount: taskMode.editCount,
        timeSpentSecs: Math.round(taskMode.elapsedSecs),
      });
      finishSubmit();
    } catch (e) {
      console.error('[viewer] Submit failed:', e);
    }
  }

  /** A submitted task is read-only (the server refuses its saves): leave edit mode, keeping the edits on screen */
  function finishSubmit() {
    taskMode.markSubmitted();
    showSubmitDialog = false;
    if (editor.editing) {
      writeBackEdits();
      editor.exitEditMode();
    }
  }

  // --- Context menu ---
  function openContextMenu(x: number, y: number, type: EditableType, index: number) {
    editor.select(type, index);
    contextMenu = { x, y, type, index };
  }

  function handleBlockContextMenu(type: EditableType) {
    return (e: MouseEvent, _item: unknown, index: number) => {
      e.preventDefault();
      // Keyboard-invoked (menu key / ⇧F10): anchor under the focused block
      if (e.clientX === 0 && e.clientY === 0 && e.target instanceof Element) {
        const r = (e.target.closest('[data-block-index]') ?? e.target).getBoundingClientRect();
        openContextMenu(r.left, r.bottom, type, index);
      } else {
        openContextMenu(e.clientX, e.clientY, type, index);
      }
    };
  }

  const EDITABLE_TO_TRACK: Record<EditableType, TrackId> = {
    states: 'states',
    intents: 'intents',
    transcription: 'transcription',
    backchannels: 'backchannels',
    userLabels: 'user_labels',
  };

  /** Menu key with no block focused: open the menu at the selected block */
  function openContextMenuForSelection() {
    const sel = selected;
    if (!sel) return;
    const el = timelineContainerEl?.querySelector(
      `[data-track-content="${EDITABLE_TO_TRACK[sel.type]}"] [data-block-index="${sel.index}"]`,
    );
    const r = el?.getBoundingClientRect() ?? timelineContainerEl.getBoundingClientRect();
    openContextMenu(r.left, r.bottom, sel.type, sel.index);
  }

  const contextMenuItems = $derived.by((): MenuEntry[] => {
    if (!contextMenu || !selected || selected.type !== contextMenu.type || selected.index !== contextMenu.index) return [];
    const sel = selected;
    const { start, end } = sel.item.time_range;
    const unavailable: BlockMenuAction[] = [];
    if (sel.type === 'userLabels' || isHumanReviewed(sel.item)) unavailable.push('confirm');
    if (!isReclassifiable(sel.type)) unavailable.push('reclassify');
    if (sel.index + 1 >= sel.array.length) unavailable.push('merge');
    if (timeline.currentTime <= start + 0.05 || timeline.currentTime >= end - 0.05) unavailable.push('split');
    return blockMenuItems({
      actions: {
        confirm: confirmSelected,
        reclassify: openReclassify,
        split: splitSelected,
        merge: mergeSelected,
        jump: () => seekTo(start),
        delete: deleteSelected,
      },
      isAllowed: (op) =>
        !taskMode.active ||
        (taskMode.isTypeEditable(EDITABLE_TO_ANNOTATION_TYPE[sel.type]) && taskMode.isOperationAllowed(op)),
      locked: taskMode.active && taskMode.isTimeLocked(sel.item.time_range),
      unavailable,
    });
  });

  // --- Status bar selection ---
  const EDITABLE_KIND: Record<EditableType, string> = {
    states: 'state',
    intents: 'intent',
    transcription: 'word',
    backchannels: 'backchannel',
    userLabels: 'label',
  };

  const statusSelection = $derived.by((): StatusSelection | null => {
    if (selected) {
      return { kind: EDITABLE_KIND[selected.type], index: selected.index, start: selected.item.time_range.start, end: selected.item.time_range.end };
    }
    const item = session.selectedAnnotation as { time_range?: TimeRange } | null;
    if (editor.editing || !item?.time_range) return null;
    const lists: [string, readonly unknown[] | undefined][] = [
      ['intent', annotations.intentClassification?.data],
      ['word', annotations.transcription?.data],
      ['state', annotations.stateAnnotation?.data],
      ['label', annotations.userLabels?.data],
      ['backchannel', annotations.backchannel?.data],
    ];
    for (const [kind, list] of lists) {
      const index = list?.indexOf(item) ?? -1;
      if (index >= 0) return { kind, index, start: item.time_range.start, end: item.time_range.end };
    }
    return null;
  });

  // --- Keyboard shortcuts ---
  /** Keys that act on the viewer only when focus isn't on a control (buttons, links, fields) */
  function isNeutralTarget(target: EventTarget | null): boolean {
    return isRootTarget(target) || (target instanceof HTMLElement && target.hasAttribute('data-block-index'));
  }

  /** Body or the viewer root itself: nothing focused that owns Space / ↵ */
  function isRootTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return true;
    return target === document.body || target.closest('[data-viewer-root]') === target;
  }

  /**
   * Where ⇥ steps the review queue: only the viewer root, which a pointer pick
   * of a queue row focuses. On a block Tab stays native (blocks use a roving
   * tabindex per track: ⇥ moves between tracks, ←/→ between blocks), and on
   * the body it must follow native order into the header after load.
   */
  function isReviewTabTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.hasAttribute('data-viewer-root');
  }

  function moveTrackForFocus(delta: -1 | 1): boolean {
    const active = document.activeElement as HTMLElement | null;
    const row = active?.closest<HTMLElement>('[data-track-row]');
    const id = (row?.dataset.trackRow as TrackId | undefined) ?? (selected ? EDITABLE_TO_TRACK[selected.type] : undefined);
    return id ? trackLayout.move(id, delta) : false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
    // Open dialogs and menus own the keyboard (they also stop propagation)
    if (overlayOpen) return;

    const mod = e.metaKey || e.ctrlKey;

    if (e.key === '?' && !mod) {
      e.preventDefault();
      showShortcutsHelp = true;
      return;
    }

    if (mod && e.code === 'KeyZ') {
      if (editor.editing) {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      }
      return;
    }

    if (mod && e.code === 'KeyE') {
      e.preventDefault();
      toggleEditMode();
      return;
    }

    if (mod && e.code === 'KeyS') {
      e.preventDefault();
      if (editor.editing && (editor.hasChanges || autosave.status === 'error')) autosave.saveNow();
      return;
    }

    if (mod && e.key === 'Enter') {
      if (taskMode.editable) {
        e.preventDefault();
        handleTaskSubmit();
      }
      return;
    }

    if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (moveTrackForFocus(e.key === 'ArrowUp' ? -1 : 1)) e.preventDefault();
      return;
    }

    if (mod || e.altKey) return;

    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      if (selected && !target?.hasAttribute('data-block-index')) {
        e.preventDefault();
        openContextMenuForSelection();
      }
      return;
    }

    // A focused control keeps its own keys: Space presses buttons, radios and
    // options; arrows and Home/End move sliders (bits-ui thumbs, the overview).
    if (e.code === 'Space' && !isNeutralTarget(target)) return;
    if (
      target?.closest?.('[role="slider"]') &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')
    ) {
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
      case 'BracketLeft':
        if (selected) {
          e.preventDefault();
          seekTo(selected.item.time_range.start);
        }
        break;
      case 'KeyP':
        e.preventDefault();
        togglePip();
        break;
      case 'KeyN':
        e.preventDefault();
        if (editor.editing && !taskMode.active) editToolbar?.create('state');
        else if (!editor.editing) session.normalized = !session.normalized;
        break;
      case 'KeyI':
        if (editor.editing && !taskMode.active) {
          e.preventDefault();
          editToolbar?.create('intent');
        }
        break;
      case 'KeyB':
        if (editor.editing && !taskMode.active) {
          e.preventDefault();
          editToolbar?.create('backchannel');
        }
        break;
      case 'KeyL':
        if (editor.editing && !taskMode.active) {
          e.preventDefault();
          editToolbar?.create('label');
        }
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
        if (selected) {
          e.preventDefault();
          deleteSelected();
        }
        break;
      case 'KeyS':
        if (selected) {
          e.preventDefault();
          splitSelected();
        }
        break;
      case 'KeyM':
        if (selected) {
          e.preventDefault();
          mergeSelected();
        }
        break;
      case 'KeyC':
        if (selected) {
          e.preventDefault();
          openReclassify();
        }
        break;
      case 'Enter':
      case 'NumpadEnter':
        if (selected && isNeutralTarget(target)) {
          e.preventDefault();
          confirmSelected();
        }
        break;
      case 'Tab':
        // ⇥ / ⇧⇥ walk the review queue from the viewer root only. From a
        // block (next / previous track), the body, the header, panels or
        // labels Tab stays native, and so it does at either end of the queue
        // (no preventDefault without a step).
        if (isReviewTabTarget(target) && stepReview(e.shiftKey)) {
          e.preventDefault();
        }
        break;
      case 'Escape':
        if (editor.hasSelection) {
          e.preventDefault();
          editor.deselect();
        } else if (session.selectedAnnotation) {
          e.preventDefault();
          session.selectedAnnotation = null;
        } else if (editor.editing && !taskMode.active) {
          e.preventDefault();
          toggleEditMode();
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
      const newScrollLeft = Math.min(timeline.timeToPx(timeline.currentTime) - 100, timeline.maxScrollLeft);
      timeline.scrollLeft = newScrollLeft;
      timelineContainerEl.scrollLeft = newScrollLeft;
    }
  });

  // --- Fit zoom once duration and width are known; then apply ?t= (and the fixture's design zoom) ---
  let initialViewApplied = false;
  $effect(() => {
    if (timeline.containerWidth <= 0 || timeline.duration <= 0) return;
    untrack(() => {
      timeline.fitZoomToContainer();
      if (initialViewApplied) return;
      initialViewApplied = true;
      const t = props.initialTime;
      if (t != null && t > 0) timeline.currentTime = clampTime(t);
      if (fixture) {
        timeline.zoom = FIXTURE_ZOOM;
        tick().then(() => scrollToTime(timeline.currentTime - (timeline.containerWidth * FIXTURE_PLAYHEAD_AT) / timeline.zoom));
      }
    });
  });

  // --- Auto-save: draft backup + debounced save on every markDirty ---
  $effect(() => {
    void editor.dirtyVersion;
    if (untrack(() => editor.hasChanges)) {
      autosave.saveDraft();
      autosave.scheduleSave();
    }
  });

  // --- Draft recovery ---
  function restoreDraft() {
    if (!pendingDraft) return;
    // A read-only task can't take edits
    if (taskMode.active && !taskMode.editable) return;
    if (!editor.editing) editor.enterEditMode(annotations);
    if (pendingDraft.states) editor.states = pendingDraft.states as typeof editor.states;
    if (pendingDraft.intents) editor.intents = pendingDraft.intents as typeof editor.intents;
    if (pendingDraft.transcription) editor.transcription = pendingDraft.transcription as typeof editor.transcription;
    if (pendingDraft.backchannels) editor.backchannels = pendingDraft.backchannels as typeof editor.backchannels;
    if (pendingDraft.userLabels) editor.userLabels = pendingDraft.userLabels as typeof editor.userLabels;
    pendingDraft = null;
  }

  function discardDraft() {
    AutoSaveState.discardDraft(videoId);
    pendingDraft = null;
  }

  // --- Fixture (/dev/viewer) ---
  function initFixture(f: ViewerFixture) {
    loadFixture({ fixture: f, annotations, timeline, session });
    if (f.task) {
      // The fixture's assignee is 'fixture-assignee'; `as=other` opens it as someone else
      const info: TaskInfo = {
        id: f.task.id,
        videoId,
        taskType: f.task.type,
        status: 'in_progress',
        constraints: f.task.constraints,
        reviewNotes: f.task.feedback ?? null,
        reviewResult: null,
        assignedTo: 'fixture-assignee',
        assigneeName: f.task.assignee,
      };
      const viewer = f.task.viewer === 'other' ? 'fixture-other' : 'fixture-assignee';
      startTask(info, taskAccessFor(info, viewer).reason);
      taskTitle = f.task.title;
      taskDetails = {
        assignedBy: f.task.assignedBy,
        dueDate: f.task.dueDate,
        brief: f.task.brief,
        feedbackBy: f.task.feedback ? f.task.assignedBy : null,
        feedbackAt: f.task.feedbackAt ?? null,
      };
    } else if (f.mode === 'edit') {
      editor.enterEditMode(annotations);
    }
  }

  // --- onMount: observers, listeners, data loading, cleanup ---
  onMount(() => {
    // Timeline viewport width = scroll container minus the sticky label column
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        timeline.containerWidth = Math.max(0, entry.contentRect.width - LABEL_WIDTH);
      }
    });
    observer.observe(timelineContainerEl);
    timelineContainerEl.addEventListener('wheel', handleWheel, { passive: false });

    const html = document.documentElement;
    const themeObserver = new MutationObserver(() => {
      isDark = html.classList.contains('dark');
    });
    themeObserver.observe(html, { attributes: true, attributeFilter: ['class'] });
    isDark = html.classList.contains('dark');

    // Save on page close
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!fixture && editor.editing && editor.hasChanges) {
        autosave.saveNow(); // fire-and-forget
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);

    if (fixture) {
      initFixture(fixture);
    } else {
      const client = createSupabaseBrowserClient();
      supabase = client;
      trpc = createTRPCClientInstance(async () => {
        const { data } = await client.auth.getSession();
        return data.session?.access_token ?? null;
      });
      dataLoader = createDataLoader({ trpc, annotations, timeline, session, videoId });
      client.auth.getSession().then(({ data }) => {
        userId = data.session?.user.id ?? null;
        editor.reviewerId = userId;
        trackLayout.setUser(userId);
      });
      loadViewerData();
    }

    return () => {
      observer.disconnect();
      timelineContainerEl?.removeEventListener('wheel', handleWheel);
      themeObserver.disconnect();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      dataLoader?.dispose();
      autosave.dispose();
      taskMode.dispose();
      taskMode.connectReview(null);
    };
  });

  async function loadViewerData() {
    if (!dataLoader) return;
    try {
      await dataLoader.loadViewerData();
      if (taskId) await initTaskMode();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load viewer data';
    }
  }

  // Rendered track count (ruler corner)
  const trackCount = $derived(availableTracks.size);
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet placeholder(status: string, what: string)}
  <div class="w-full h-full flex items-center px-3">
    {#if status === 'error'}
      <span class="text-viewer-sm text-viewer-danger">Failed to load {what}</span>
    {:else if status === 'loading'}
      <span class="text-viewer-sm text-viewer-text-dim">Loading {what}…</span>
    {/if}
  </div>
{/snippet}

{#snippet waveformLegend()}
  <span class="flex gap-2 font-mono text-viewer-xs text-viewer-text-dim">
    {#if annotations.waveform?.peaks_r}
      <span class="flex items-center gap-1"><span class="legend-swatch" style="background: {palette.waveformL}"></span>L · S0</span>
      <span class="flex items-center gap-1"><span class="legend-swatch" style="background: {palette.waveformR}"></span>R · S1</span>
    {:else}
      <span class="flex items-center gap-1"><span class="legend-swatch" style="background: {palette.waveformMono}"></span>mono</span>
    {/if}
  </span>
{/snippet}

{#snippet headPoseLegend()}
  <span class="flex gap-2 font-mono text-viewer-xs text-viewer-text-dim">
    <span class="flex items-center gap-1"><span class="legend-swatch" style="background: {palette.headPitch}"></span>pitch</span>
    <span class="flex items-center gap-1"><span class="legend-swatch" style="background: {palette.headYaw}"></span>yaw</span>
    <span class="flex items-center gap-1"><span class="legend-swatch" style="background: {palette.headRoll}"></span>roll</span>
  </span>
  <span class="font-mono text-viewer-xs text-viewer-text-dim">{poseRangeLabel}</span>
{/snippet}

{#snippet trackBody(t: TrackConfig, h: number)}
  {#if t.id === 'waveform'}
    {#if annotations.waveform}
      <CanvasTrack height={h} draw={drawWaveformTrack} onScrub={handleScrub} />
    {:else}
      {@render placeholder(annotations.loadStatus.waveform, 'waveform')}
    {/if}
  {:else if t.id === 'vad'}
    {#if annotations.vad?.frames}
      <CanvasTrack height={h} draw={drawVadTrack} onScrub={handleScrub} />
    {:else}
      {@render placeholder(annotations.loadStatus.vad, 'VAD data')}
    {/if}
  {:else if t.id === 'diarization'}
    {#if annotations.diarization?.data}
      <CanvasTrack height={h} draw={drawDiarizationTrack} onScrub={handleScrub} />
    {:else}
      {@render placeholder(annotations.loadStatus.diarization, 'diarization')}
    {/if}
  {:else if t.id === 'mouth_energy'}
    {#if annotations.mouthEnergy?.data}
      <CanvasTrack height={h} draw={drawMouthEnergyTrack} onScrub={handleScrub} />
    {:else}
      {@render placeholder(annotations.loadStatus.mouth_energy, 'mouth energy')}
    {/if}
  {:else if t.id === 'head_pose'}
    {#if annotations.facialTracking?.data}
      <CanvasTrack height={h} draw={drawHeadPoseTrack} onScrub={handleScrub} />
    {:else}
      {@render placeholder(annotations.loadStatus.facial_tracking, 'head pose')}
    {/if}
  {:else if t.id === 'transcription'}
    {#if !currentWords}
      {@render placeholder(annotations.loadStatus.transcription, 'transcription')}
    {:else if useSegmentLOD}
      <DOMTrack
        data={transcriptionSegments}
        label="Transcription phrases"
        height={h}
        padX={3}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={segmentBlockClass}
        blockLabel={segmentBlockLabel}
        isSelected={isViewSelected}
        onBlockClick={handleBlockClick}
        onReveal={scrollToTime}
      />
    {:else if editor.editing && editor.transcription}
      <EditableDOMTrack
        data={editor.transcription}
        editableType="transcription"
        label="Transcription"
        height={h}
        padX={3}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={wordBlockClass}
        blockLabel={wordBlockLabel}
        onBlockContextMenu={handleBlockContextMenu('transcription')}
        onReveal={scrollToTime}
      />
    {:else}
      <DOMTrack
        data={currentWords}
        label="Transcription"
        height={h}
        padX={3}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={wordBlockClass}
        blockLabel={wordBlockLabel}
        getSource={sourceOf}
        isLowConfidence={lowConfOf}
        getConfidence={confOf}
        isSelected={isViewSelected}
        isLocked={isItemLocked}
        onBlockClick={handleBlockClick}
        onReveal={scrollToTime}
      />
    {/if}
  {:else if t.id === 'states'}
    {#if editor.editing && editor.states}
      <EditableDOMTrack
        data={editor.states}
        editableType="states"
        label="States"
        height={h}
        minLabelWidth={40}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={stateBlockClass}
        blockLabel={stateBlockLabel}
        onBlockContextMenu={handleBlockContextMenu('states')}
        onReveal={scrollToTime}
      />
    {:else if annotations.stateAnnotation?.data}
      <DOMTrack
        data={annotations.stateAnnotation.data}
        label="States"
        height={h}
        minLabelWidth={40}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={stateBlockClass}
        blockLabel={stateBlockLabel}
        getSource={sourceOf}
        isSelected={isViewSelected}
        onBlockClick={handleBlockClick}
        onReveal={scrollToTime}
      />
    {:else}
      {@render placeholder(annotations.loadStatus.state_annotation, 'states')}
    {/if}
  {:else if t.id === 'intents'}
    {#if editor.editing && editor.intents}
      <EditableDOMTrack
        data={editor.intents}
        editableType="intents"
        label="Intents"
        height={h}
        inset={6}
        padX={6}
        minLabelWidth={30}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={intentBlockClass}
        blockLabel={intentBlockLabel}
        onBlockContextMenu={handleBlockContextMenu('intents')}
        onReveal={scrollToTime}
      />
    {:else if annotations.intentClassification?.data}
      <DOMTrack
        data={annotations.intentClassification.data}
        label="Intents"
        height={h}
        inset={6}
        padX={6}
        minLabelWidth={30}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={intentBlockClass}
        blockLabel={intentBlockLabel}
        getSource={sourceOf}
        isLowConfidence={lowConfOf}
        getConfidence={confOf}
        isSelected={isViewSelected}
        onBlockClick={handleBlockClick}
        onReveal={scrollToTime}
      />
    {:else}
      {@render placeholder(annotations.loadStatus.intent_classification, 'intents')}
    {/if}
  {:else if t.id === 'backchannels'}
    {#if editor.editing && editor.backchannels}
      <EditableDOMTrack
        data={editor.backchannels}
        editableType="backchannels"
        label="Backchannels"
        height={h}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={backchannelBlockClass}
        blockLabel={backchannelBlockLabel}
        onBlockContextMenu={handleBlockContextMenu('backchannels')}
        onReveal={scrollToTime}
      />
    {:else if annotations.backchannel?.data}
      <DOMTrack
        data={annotations.backchannel.data}
        label="Backchannels"
        height={h}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={backchannelBlockClass}
        blockLabel={backchannelBlockLabel}
        getSource={sourceOf}
        isSelected={isViewSelected}
        onBlockClick={handleBlockClick}
        onReveal={scrollToTime}
      />
    {/if}
  {:else if t.id === 'user_labels'}
    {#if editor.editing && editor.userLabels}
      <EditableDOMTrack
        data={editor.userLabels}
        editableType="userLabels"
        label="User labels"
        height={h}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={userLabelBlockClass}
        blockLabel={userLabelBlockLabel}
        onBlockDoubleClick={handleLabelDoubleClick}
        onBlockContextMenu={handleBlockContextMenu('userLabels')}
        onReveal={scrollToTime}
      />
    {:else if annotations.userLabels?.data}
      <DOMTrack
        data={annotations.userLabels.data}
        label="User labels"
        height={h}
        getStart={getTimeRangeStart}
        getEnd={getTimeRangeEnd}
        blockClass={userLabelBlockClass}
        blockLabel={userLabelBlockLabel}
        getSource={sourceOf}
        isSelected={isViewSelected}
        onBlockClick={handleBlockClick}
        onReveal={scrollToTime}
      />
    {/if}
  {/if}
{/snippet}

<div
  bind:this={rootEl}
  class="viewer-theme h-screen w-screen flex flex-col overflow-hidden bg-viewer-bg text-viewer-text"
  role="region"
  aria-label="Timeline viewer"
  tabindex="-1"
  data-viewer-root
  data-mode={viewerMode}
>
  <ViewerHeader
    onTogglePlay={togglePlay}
    onTogglePip={togglePip}
    onToggleEditMode={toggleEditMode}
    onTaskSubmit={handleTaskSubmit}
    {autosave}
    taskMode={taskMode.active ? taskMode : null}
    {showShortcutsHelp}
    onToggleShortcutsHelp={() => (showShortcutsHelp = !showShortcutsHelp)}
    projectName={session.projectName}
    backHref={fixture ? '/dev/viewer' : undefined}
    {taskTitle}
    {taskRef}
  />

  {#if loadError}
    <div class="load-error flex-none px-3 py-2 text-viewer-sm text-viewer-danger border-b border-viewer-border" role="alert">
      {loadError}
    </div>
  {/if}

  {#if pendingDraft && (!taskMode.active || taskMode.editable)}
    <DraftRecoveryBanner
      draft={pendingDraft}
      isStale={annotations.latestEditTimestamp !== null && pendingDraft.savedAt < annotations.latestEditTimestamp}
      onRestore={restoreDraft}
      onDiscard={discardDraft}
    />
  {/if}

  {#if taskMode.active}
    <TaskToolbar />
  {:else}
    <EditToolbar
      bind:this={editToolbar}
      onConfirm={confirmSelected}
      onReclassify={openReclassify}
      onSplit={splitSelected}
      onMerge={mergeSelected}
      onDelete={deleteSelected}
      {userId}
    />
  {/if}

  <!-- Top band: video 711 · inspector 460 · review queue / task panel -->
  <div class="top-band flex-none flex border-b border-viewer-border">
    <!-- PiP hides the column with CSS only: destroying <video> would end PiP -->
    <div class="video-col flex-none min-w-0" class:video-col-hidden={session.pipActive}>
      <VideoPlayer bind:this={videoPlayer} src={session.videoSrc} />
    </div>
    <div class="inspector-col flex-none min-w-0 bg-viewer-surface border-x border-viewer-border">
      <InspectorPanel onConfirm={confirmSelected} onReclassify={openReclassify} />
    </div>
    <div class="flex-1 min-w-0 bg-viewer-surface">
      {#if taskMode.active}
        <TaskPanel
          {taskMode}
          details={taskDetails}
          queue={activeQueue}
          selectedKey={selectedQueueKey}
          onSelect={selectReviewItem}
        />
      {:else}
        <ReviewQueue
          items={queueRows}
          selectedKey={selectedQueueKey}
          reviewedKeys={reviewedQueueKeys}
          onSelect={selectReviewItem}
          bind:filter={reviewFilter}
        />
      {/if}
    </div>
  </div>

  <!-- Timeline: ruler, grouped track rows (184px sticky labels + content), overview -->
  <div class="flex-1 min-h-0 flex flex-col bg-viewer-surface">
    <!-- Ruler: outside the vertical scroll, follows scrollLeft -->
    <div class="flex flex-none border-b border-viewer-border" style="height: {RULER_HEIGHT}px">
      <div
        class="flex-none flex items-center gap-2 px-2.5 bg-viewer-bg border-r border-viewer-border font-mono text-viewer-xs uppercase tracking-label text-viewer-text-subtle"
        style="width: {LABEL_WIDTH}px"
      >
        Tracks<span class="flex-1"></span><span class="tracking-normal">{trackCount}</span>
      </div>
      <div class="relative flex-1 min-w-0 overflow-hidden bg-viewer-bg">
        <div
          class="absolute top-0 left-0 h-full"
          style="width: {timelineWidth}px; transform: translateX({-timeline.clampedScrollLeft}px)"
        >
          <CanvasTrack height={RULER_HEIGHT} draw={drawRulerTrack} onScrub={handleScrub} />
          <Playhead />
        </div>
      </div>
    </div>

    <div
      bind:this={timelineContainerEl}
      class="viewer-timeline relative flex-1 min-h-0 overflow-auto"
      onscroll={handleTimelineScroll}
      aria-label="Annotation tracks"
      role="group"
    >
      <div class="relative" style="width: {LABEL_WIDTH + timelineWidth}px; min-width: 100%">
        {#each trackLayout.visibleTracks as group (group.id)}
          <div class="flex">
            <div class="track-label-cell flex-none" style="width: {LABEL_WIDTH}px">
              <TrackGroup
                id={group.id}
                label={group.label}
                collapsed={group.collapsed}
                count={groupCount(group.id)}
                labelWidth={null}
                onToggle={(id) => trackLayout.toggleCollapse(id)}
              />
            </div>
            <div
              class="flex-1 bg-viewer-surface-2 border-b border-viewer-border"
              style="height: {GROUP_HEADER_HEIGHT}px"
            ></div>
          </div>

          {#each group.tracks as t (t.id)}
            {@const h = trackLayout.renderHeight(t.id)}
            {@const editable = isTrackEditable(t)}
            <div class="flex" data-track-row={t.id}>
              <div class="track-label-cell flex-none" style="width: {LABEL_WIDTH}px">
                <TrackLabel
                  track={t}
                  height={h}
                  mode={viewerMode}
                  {editable}
                  locked={taskMode.active && t.kind === 'editable' && !editable}
                  meta={trackMeta(t)}
                  lowConfCount={trackLowConf(t)}
                  legend={t.id === 'waveform' ? waveformLegend : t.id === 'head_pose' ? headPoseLegend : undefined}
                  guideExtent={timeline.containerWidth}
                  onResize={(id, px) => trackLayout.setHeight(id, px)}
                  onReorder={(from, to) => trackLayout.reorder(from, to)}
                  onMove={(id, d) => trackLayout.move(id, d)}
                  onToggleCollapse={(id) => trackLayout.toggleCollapse(id)}
                />
              </div>
              <div class="flex-none" style="width: {timelineWidth}px">
                <TrackContent id={t.id} height={h}>
                  {@render trackBody(t, h)}
                </TrackContent>
              </div>
            </div>
          {/each}
        {/each}

        <!-- Playhead + locked ranges, in timeline coordinates (x=0 is t=0) -->
        <div
          class="absolute top-0 bottom-0 pointer-events-none"
          style="left: {LABEL_WIDTH}px; width: {timelineWidth}px"
        >
          {#if taskMode.active}
            {#each taskMode.lockedTimeRanges as range (`${range.start}-${range.end}`)}
              <div
                class="locked-region-overlay locked-range absolute top-0 bottom-0 z-20"
                style="left: {timeline.timeToPx(range.start)}px; width: {timeline.timeToPx(range.end - range.start)}px"
              >
                <span class="locked-tag font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  Locked
                </span>
              </div>
            {/each}
          {/if}
          <Playhead cap={false} />
        </div>
      </div>
    </div>

    <TimelineOverview
      {palette}
      diarization={annotations.diarization?.data}
      words={currentWords}
      intents={currentIntents}
      lockedRanges={taskMode.active ? taskMode.lockedTimeRanges : []}
      labelWidth={LABEL_WIDTH}
      onScrollTo={scrollToTime}
      onSeek={seekTo}
    />
  </div>

  <ViewerStatusBar
    mode={viewerMode}
    taskType={taskMode.task?.taskType ?? null}
    selection={statusSelection}
    hints={taskMode.active && !taskMode.editable ? 'READ-ONLY · SPACE play · ←/→ 1 s · ⇥ step review (from queue) · ? shortcuts' : undefined}
  />

  {#if showClassifyDialog && selected && (selected.type === 'intents' || selected.type === 'states')}
    {@const item = selected.item as StateAnnotation & IntentAnnotation}
    <ClassifyDialog
      editableType={selected.type}
      currentCategory={selected.type === 'states' ? item.category : undefined}
      currentIntent={selected.type === 'intents' ? item.intent_classification.intent : undefined}
      currentIntensity={selected.type === 'intents' ? item.intent_classification.intensity : undefined}
      currentValence={selected.type === 'intents' ? item.intent_classification.valence : undefined}
      ordinal={selected.index + 1}
      timeRange={item.time_range}
      aiLabel={getProvenance(selected.item) === 'ai' ? getItemLabel(selected.item) : undefined}
      aiConfidence={getConfidence(selected.item)}
      allowedCategories={taskMode.active ? (taskMode.constraints?.allowedCategories ?? null) : null}
      onConfirm={handleClassify}
      onClose={() => (showClassifyDialog = false)}
    />
  {/if}

  {#if showLabelTextDialog}
    <LabelTextDialog
      currentText={labelTextDialogCurrent}
      onConfirm={handleLabelTextConfirm}
      onClose={() => (showLabelTextDialog = false)}
    />
  {/if}

  {#if contextMenu && contextMenuItems.length > 0}
    <ContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      items={contextMenuItems}
      onClose={() => (contextMenu = null)}
    />
  {/if}

  {#if showSubmitDialog}
    <TaskSubmitDialog
      editCount={taskMode.editCount}
      elapsedSecs={taskMode.elapsedSecs}
      {coverageErrors}
      {coverageGaps}
      reviewedCount={taskMode.reviewedCount}
      totalReviewable={taskMode.totalReviewable}
      reviewApplicable={taskMode.hasReviewScope}
      {reviewedLabel}
      reviewerName={taskDetails?.assignedBy ?? null}
      onJumpToGap={(t) => {
        seekTo(t);
        revealRange(t);
      }}
      onConfirm={confirmSubmit}
      onCancel={() => (showSubmitDialog = false)}
    />
  {/if}
</div>

<style>
  .top-band {
    height: 400px;
  }

  /* Focus parks on the root after a queue click (so ↵ / ⇥ drive review); never draw a ring round the whole viewer */
  [data-viewer-root]:focus {
    outline: none;
  }

  .video-col {
    width: 711px;
  }

  /* PiP: collapse the column, keep <video> mounted */
  .video-col-hidden {
    width: 0;
    overflow: hidden;
  }

  .inspector-col {
    width: 460px;
  }

  /* Label cells stay put while the timeline scrolls horizontally, above the playhead (z-30) */
  .track-label-cell {
    position: sticky;
    left: 0;
    z-index: 40;
    background-color: var(--viewer-bg);
  }

  .legend-swatch {
    display: inline-block;
    width: 8px;
    height: 2px;
  }

  .locked-range {
    border-left: 1px solid var(--viewer-border);
    border-right: 1px solid var(--viewer-border);
  }

  .locked-tag {
    position: absolute;
    left: 6px;
    top: 5px;
    height: 18px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    background-color: var(--viewer-surface-2);
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
    white-space: nowrap;
  }

  .load-error {
    background-color: color-mix(in srgb, var(--viewer-danger) 8%, transparent);
  }
</style>
