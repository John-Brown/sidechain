<script lang="ts" module>
  /** What the "Add at playhead" buttons create. */
  export type CreateKind = 'state' | 'intent' | 'backchannel' | 'label';
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { getTimelineState, getEditorState, getTaskModeState } from '../context.js';
  import type { EditableType } from '../state/editor.svelte.js';
  import type {
    AnnotationSetType,
    StateAnnotation,
    IntentAnnotation,
    BackchannelAnnotation,
    UserLabel,
    TimeRange,
  } from '@annotation/shared';
  import { createAnnotation } from '../editing/operations.js';
  import { validateTimeRange } from '../editing/time-validation.js';
  import {
    getItemLabel,
    isHumanReviewed,
    withReview,
    MANUAL_INTENT_REASONING,
    type ReviewableAnnotation,
  } from '../review.js';

  interface Props {
    /** ↵ Confirm the selected AI prediction. Hidden when omitted. */
    onConfirm?: () => void;
    /** C Reclassify (opens ClassifyDialog, or the label text dialog for labels). */
    onReclassify?: () => void;
    /** S Split the selection at the playhead. */
    onSplit?: () => void;
    /** M Merge the selection with its neighbour. */
    onMerge?: () => void;
    /** ⌫ Delete the selection. */
    onDelete?: () => void;
    /** Defaults to editor.undo(). */
    onUndo?: () => void;
    /** Defaults to editor.redo(). */
    onRedo?: () => void;
    /** Called after an "Add at playhead" create; the new item is already selected. */
    onCreated?: (type: EditableType, index: number) => void;
    /** Session edit count shown next to undo/redo. Defaults to dirtyVersion bumps since entering edit mode. */
    editCount?: number;
    /** Stamped as review.by on created items. */
    userId?: string | null;
  }

  let {
    onConfirm,
    onReclassify,
    onSplit,
    onMerge,
    onDelete,
    onUndo,
    onRedo,
    onCreated,
    editCount,
    userId = null,
  }: Props = $props();

  const timeline = getTimelineState();
  const editor = getEditorState();
  const taskMode = getTaskModeState();

  const DEFAULT_DURATION = 1; // seconds
  const SPLIT_MARGIN = 0.05; // matches AnnotationViewer.splitSelected

  const KIND_TO_TYPE: Record<CreateKind, EditableType> = {
    state: 'states',
    intent: 'intents',
    backchannel: 'backchannels',
    label: 'userLabels',
  };
  const KIND_TO_SET_TYPE: Record<CreateKind, AnnotationSetType> = {
    state: 'state',
    intent: 'intent',
    backchannel: 'backchannel',
    label: 'user_labels',
  };

  const CREATE_BUTTONS: { kind: CreateKind; label: string; key: string; hue: string }[] = [
    { kind: 'state', label: 'State', key: 'N', hue: 'hue-speaking' },
    { kind: 'intent', label: 'Intent', key: 'I', hue: 'hue-intent-engage' },
    { kind: 'backchannel', label: 'Backchannel', key: 'B', hue: 'hue-backchannel' },
    { kind: 'label', label: 'Label', key: 'L', hue: 'hue-label' },
  ];

  const TYPE_NOUN: Record<EditableType, string> = {
    states: 'State',
    intents: 'Intent',
    transcription: 'Word',
    backchannels: 'Backchannel',
    userLabels: 'Label',
  };

  // --- Edit count: dirtyVersion is monotonic, so count bumps since entering edit mode ---
  let editBaseline = $state(0);
  $effect(() => {
    if (editor.editing) editBaseline = untrack(() => editor.dirtyVersion);
  });
  const edits = $derived(editCount ?? Math.max(0, editor.dirtyVersion - editBaseline));

  // --- Selection ---
  const selected = $derived.by(() => {
    const type = editor.selectedType;
    const idx = editor.selectedIndex;
    if (type === null || idx === null) return null;
    const item = (editor[type] as ReviewableAnnotation[] | null)?.[idx];
    if (!item) return null;
    return { type, index: idx, item, range: item.time_range as TimeRange };
  });

  const selectionLabel = $derived.by(() => {
    if (!selected) return '';
    const raw = getItemLabel(selected.item);
    if (selected.type === 'transcription' || selected.type === 'userLabels') return `“${raw}”`;
    // expression.state.speaking → speaking
    return raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw;
  });

  const selectionLocked = $derived(!!selected && taskMode.isTimeLocked(selected.range));

  function opAllowed(op: 'confirm' | 'classify' | 'split' | 'merge' | 'delete'): boolean {
    return !!selected && !selectionLocked && taskMode.isOperationAllowed(op);
  }

  const canConfirm = $derived(
    opAllowed('confirm') && selected!.type !== 'userLabels' && !isHumanReviewed(selected!.item),
  );
  const canReclassify = $derived(opAllowed('classify'));
  const canSplit = $derived(
    opAllowed('split') &&
      timeline.currentTime > selected!.range.start + SPLIT_MARGIN &&
      timeline.currentTime < selected!.range.end - SPLIT_MARGIN,
  );
  const canMerge = $derived(
    opAllowed('merge') && ((editor[selected!.type] as unknown[] | null)?.length ?? 0) > 1,
  );
  const canDelete = $derived(opAllowed('delete'));

  // --- Create at playhead ---
  function isCreateAllowed(kind: CreateKind): boolean {
    if (!taskMode.active) return true;
    if (!taskMode.isOperationAllowed('create')) return false;
    return taskMode.constraints?.editableTypes?.includes(KIND_TO_SET_TYPE[kind]) ?? false;
  }

  function isCreateAvailable(kind: CreateKind): boolean {
    // States and intents need loaded data; backchannels and labels start empty.
    if (kind === 'state' && editor.states === null) return false;
    if (kind === 'intent' && editor.intents === null) return false;
    return isCreateAllowed(kind);
  }

  function makeRange(): TimeRange {
    const start = timeline.currentTime;
    const end = Math.min(start + DEFAULT_DURATION, timeline.duration);
    return { start, end };
  }

  function canCreateAt(items: { time_range: TimeRange }[], range: TimeRange): boolean {
    if (!validateTimeRange(range, timeline.duration).valid) return false;
    if (taskMode.isTimeLocked(range)) return false;
    return !items.some((item) => range.start < item.time_range.end && range.end > item.time_range.start);
  }

  function buildItem(kind: CreateKind, range: TimeRange): StateAnnotation | IntentAnnotation | BackchannelAnnotation | UserLabel {
    const by = userId ?? undefined;
    switch (kind) {
      case 'state':
        return withReview<StateAnnotation>(
          { time_range: range, category: 'expression.state.speaking', note: '', parameters: {} },
          { confirmed: false, by },
        );
      case 'intent':
        return withReview<IntentAnnotation>(
          {
            time_range: range,
            intent_classification: {
              intent: 'engage',
              intensity: 'moderate',
              valence: 'neutral',
              confidence: 1.0,
              reasoning: MANUAL_INTENT_REASONING,
            },
          },
          { confirmed: false, by },
        );
      case 'backchannel':
        return withReview<BackchannelAnnotation>(
          { time_range: range, backchannel: { type: 'acknowledgment', speaker: 'SPEAKER_00', note: '' } },
          { confirmed: false, by },
        );
      case 'label':
        return { time_range: range, text: 'Label' };
    }
  }

  /**
   * Create an annotation of `kind` at the playhead (1 s, clamped to the
   * duration). Also the entry point for the N / I / B / L shortcuts via
   * bind:this. Returns false when not editing, not allowed by the task, the
   * range is invalid or locked, or it would overlap an existing item.
   */
  export function create(kind: CreateKind): boolean {
    if (!editor.editing || !isCreateAvailable(kind)) return false;
    const type = KIND_TO_TYPE[kind];
    if (type === 'backchannels' && editor.backchannels === null) editor.backchannels = [];
    if (type === 'userLabels' && editor.userLabels === null) editor.userLabels = [];

    const arr = editor[type] as { time_range: TimeRange }[] | null;
    if (!arr) return false;
    const range = makeRange();
    if (!canCreateAt(arr, range)) return false;

    const newItem = buildItem(kind, range);
    editor.pushUndo(type);
    const beforeSnapshot = structuredClone($state.snapshot(arr));
    const newArr = createAnnotation(arr, newItem as { time_range: TimeRange });
    (editor as unknown as Record<string, unknown>)[type] = newArr;
    editor.recordEdit(type, {
      editType: 'create',
      targetIndex: null,
      beforeState: beforeSnapshot,
      afterState: structuredClone($state.snapshot(newArr)),
    });
    editor.lastEditedType = type;
    editor.markDirty(type);
    if (taskMode.active) taskMode.recordEdit();

    const index = newArr.indexOf(newItem as { time_range: TimeRange });
    if (index >= 0) {
      editor.select(type, index);
      onCreated?.(type, index);
    }
    return true;
  }

  function fmtS(t: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m.toString().padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }

  const undo = () => (onUndo ? onUndo() : editor.undo());
  const redo = () => (onRedo ? onRedo() : editor.redo());
  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
</script>

{#if editor.editing}
  <div class="edit-toolbar" role="toolbar" aria-label="Edit toolbar">
    <span class="tb-tag">Editing</span>

    <span class="tb-caption tb-caption-lead">Add at playhead</span>
    {#each CREATE_BUTTONS as btn (btn.kind)}
      {#if isCreateAvailable(btn.kind)}
        <button
          type="button"
          class="tb-btn"
          onclick={() => create(btn.kind)}
          title="Add {btn.label.toLowerCase()} at playhead ({btn.key})"
        >
          <span class="tb-swatch {btn.hue}" aria-hidden="true"></span>
          {btn.label}
          <span class="tb-key" aria-hidden="true">{btn.key}</span>
        </button>
      {/if}
    {/each}

    <div class="tb-divider" aria-hidden="true"></div>

    <span class="tb-caption">Selection</span>
    {#if selected}
      <span class="tb-selection">
        {TYPE_NOUN[selected.type]} #{selected.index + 1} · <span class="tb-selection-label">{selectionLabel}</span> ·
        <span class="tb-mono">{fmtS(selected.range.start)} – {fmtS(selected.range.end)}</span>
      </span>
    {:else}
      <span class="tb-selection tb-selection-empty">Nothing selected</span>
    {/if}

    {#if onConfirm}
      <button type="button" class="tb-btn tb-btn-confirm" onclick={onConfirm} disabled={!canConfirm} title="Confirm prediction (↵)">
        Confirm <span class="tb-key" aria-hidden="true">↵</span>
      </button>
    {/if}
    {#if onReclassify}
      <button type="button" class="tb-btn" onclick={onReclassify} disabled={!canReclassify} title="Reclassify (C)">
        Reclassify <span class="tb-key" aria-hidden="true">C</span>
      </button>
    {/if}
    {#if onSplit}
      <button type="button" class="tb-btn" onclick={onSplit} disabled={!canSplit} title="Split at playhead (S)">
        Split <span class="tb-key" aria-hidden="true">S</span>
      </button>
    {/if}
    {#if onMerge}
      <button type="button" class="tb-btn" onclick={onMerge} disabled={!canMerge} title="Merge with neighbour (M)">
        Merge <span class="tb-key" aria-hidden="true">M</span>
      </button>
    {/if}
    {#if onDelete}
      <button type="button" class="tb-btn tb-btn-danger" onclick={onDelete} disabled={!canDelete} title="Delete (⌫)">
        Delete <span class="tb-key" aria-hidden="true">⌫</span>
      </button>
    {/if}

    <div class="flex-1"></div>

    <div class="tb-history">
      <button type="button" class="tb-icon-btn" onclick={undo} disabled={!editor.canUndo} aria-label="Undo" title="Undo ({modKey}Z)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
      </button>
      <button type="button" class="tb-icon-btn" onclick={redo} disabled={!editor.canRedo} aria-label="Redo" title="Redo ({modKey}⇧Z)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
      </button>
      <span class="tb-edits">{edits} {edits === 1 ? 'edit' : 'edits'}</span>
    </div>
  </div>
{/if}

<style>
  .edit-toolbar {
    height: 36px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    box-sizing: border-box;
    white-space: nowrap;
    overflow: hidden;
    font-size: 12px;
    color: var(--viewer-text);
    background-color: var(--viewer-accent-bg);
    border-top: 2px solid var(--viewer-accent);
    border-bottom: 1px solid var(--viewer-border);
  }

  .tb-tag {
    height: 20px;
    flex: none;
    display: flex;
    align-items: center;
    padding: 0 8px;
    background-color: var(--viewer-accent);
    color: var(--viewer-accent-fg);
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .tb-caption {
    flex: none;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--viewer-text-dim);
  }

  .tb-caption-lead {
    margin-left: 6px;
  }

  .tb-divider {
    flex: none;
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background-color: var(--viewer-border);
  }

  .tb-btn {
    height: 24px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    box-sizing: border-box;
    font: inherit;
    color: var(--viewer-text);
    background-color: var(--viewer-surface);
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
    cursor: pointer;
    transition:
      color 150ms ease,
      border-color 150ms ease,
      background-color 150ms ease;
  }

  .tb-btn:hover:not(:disabled) {
    border-color: var(--viewer-accent);
  }

  .tb-btn:disabled {
    color: var(--viewer-text-subtle);
    cursor: default;
  }

  .tb-btn-confirm:not(:disabled) {
    color: var(--viewer-accent);
    border-color: var(--viewer-accent);
  }

  .tb-btn-confirm:hover:not(:disabled) {
    background-color: var(--viewer-accent-bg);
  }

  .tb-btn-danger:not(:disabled) {
    color: var(--viewer-danger);
  }

  .tb-btn-danger:hover:not(:disabled) {
    border-color: var(--viewer-danger);
  }

  /* 8px hue swatch: human fill + solid hue border (--h comes from the hue-* class) */
  .tb-swatch {
    width: 8px;
    height: 8px;
    flex: none;
    box-sizing: border-box;
    background-color: color-mix(in srgb, var(--h) var(--blk-human-bg), transparent);
    border: 1px solid var(--h);
  }

  .tb-key {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--viewer-text-subtle);
  }

  .tb-selection {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
  }

  .tb-selection-label {
    font-weight: 500;
  }

  .tb-selection-empty {
    color: var(--viewer-text-subtle);
  }

  .tb-mono {
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .tb-history {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--viewer-text);
  }

  .tb-icon-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--viewer-text);
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
    transition:
      color 150ms ease,
      background-color 150ms ease;
  }

  .tb-icon-btn:hover:not(:disabled) {
    background-color: var(--viewer-surface);
  }

  .tb-icon-btn:disabled {
    color: var(--viewer-text-subtle);
    cursor: default;
  }

  .tb-edits {
    margin-left: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--viewer-text-dim);
  }
</style>
