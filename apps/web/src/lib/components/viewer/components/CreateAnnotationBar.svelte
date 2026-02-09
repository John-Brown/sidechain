<script lang="ts">
  import { getTimelineState, getEditorState, getTaskModeState } from '../context.js';
  import type { EditableType } from '../state/editor.svelte.js';
  import type {
    StateAnnotation,
    IntentAnnotation,
    BackchannelAnnotation,
    UserLabel,
  } from '@annotation/shared';
  import { createAnnotation } from '../editing/operations.js';
  import { validateTimeRange, checkOverlap } from '../editing/time-validation.js';
  import { pushUndoForType } from '../utils/push-undo.svelte.js';

  const timeline = getTimelineState();
  const editor = getEditorState();
  const taskMode = getTaskModeState();

  /** Check if a create button should show based on task constraints */
  function isCreateAllowed(annotationType: string): boolean {
    if (!taskMode.active) return true;
    if (!taskMode.isOperationAllowed('create')) return false;
    return taskMode.constraints?.editableTypes?.includes(annotationType as any) ?? false;
  }

  const DEFAULT_DURATION = 1; // seconds

  function createAndRecord(type: EditableType, newItem: StateAnnotation | IntentAnnotation | BackchannelAnnotation | UserLabel) {
    const arr = editor[type] as { time_range: { start: number; end: number } }[] | null;
    if (!arr) return;

    pushUndoForType(editor, type);
    const beforeSnapshot = structuredClone($state.snapshot(arr));
    const newArr = createAnnotation(arr as typeof arr & { time_range: { start: number; end: number } }[], newItem as typeof arr[0]);
    (editor as unknown as Record<string, unknown>)[type] = newArr;
    editor.recordEdit(type, {
      editType: 'create',
      targetIndex: null,
      beforeState: beforeSnapshot,
      afterState: structuredClone($state.snapshot(newArr)),
    });
    editor.lastEditedType = type;
    editor.markDirty(type);
  }

  function createState() {
    if (!editor.states) return;
    const range = makeRange();
    if (!canCreate(editor.states, range)) return;

    createAndRecord('states', {
      time_range: range,
      category: 'expression.state.speaking',
      note: '',
      parameters: {},
    });
  }

  function createIntent() {
    if (!editor.intents) return;
    const range = makeRange();
    if (!canCreate(editor.intents, range)) return;

    createAndRecord('intents', {
      time_range: range,
      intent_classification: {
        intent: 'engage',
        intensity: 'moderate',
        valence: 'neutral',
        confidence: 1.0,
        reasoning: 'Manually created',
      },
    });
  }

  function createBackchannel() {
    if (!editor.backchannels) {
      editor.backchannels = [];
    }
    const range = makeRange();
    if (!canCreate(editor.backchannels, range)) return;

    createAndRecord('backchannels', {
      time_range: range,
      backchannel: {
        type: 'acknowledgment',
        speaker: 'SPEAKER_00',
        note: '',
      },
    });
  }

  function createUserLabel() {
    if (!editor.userLabels) {
      editor.userLabels = [];
    }
    const range = makeRange();
    if (!canCreate(editor.userLabels, range)) return;

    createAndRecord('userLabels', {
      time_range: range,
      text: 'Label',
    });
  }

  function makeRange() {
    const start = timeline.currentTime;
    const end = Math.min(start + DEFAULT_DURATION, timeline.duration);
    return { start, end };
  }

  function canCreate(items: { time_range: { start: number; end: number } }[], range: { start: number; end: number }): boolean {
    const result = validateTimeRange(range, timeline.duration);
    if (!result.valid) return false;

    // Check for overlap with any existing item
    for (const item of items) {
      if (range.start < item.time_range.end && range.end > item.time_range.start) {
        return false;
      }
    }
    return true;
  }

</script>

{#if editor.editing}
  <div class="create-bar">
    <span class="create-bar-label">Add at playhead:</span>
    {#if editor.states !== null && isCreateAllowed('state')}
      <button class="create-bar-btn block-speaking" onclick={createState} title="Create state annotation (N)">
        State
      </button>
    {/if}
    {#if editor.intents !== null && isCreateAllowed('intent')}
      <button class="create-bar-btn block-intent-engage" onclick={createIntent} title="Create intent annotation">
        Intent
      </button>
    {/if}
    {#if isCreateAllowed('backchannel')}
      <button class="create-bar-btn" onclick={createBackchannel} title="Create backchannel annotation">
        Backchannel
      </button>
    {/if}
    {#if isCreateAllowed('user_labels')}
      <button class="create-bar-btn block-user-label" onclick={createUserLabel} title="Create label at playhead">
        Label
      </button>
    {/if}
  </div>
{/if}

<style>
  .create-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--viewer-surface);
    border-bottom: 1px solid var(--viewer-border);
  }

  .create-bar-label {
    font-size: 11px;
    color: var(--viewer-text-dim);
    white-space: nowrap;
  }

  .create-bar-btn {
    padding: 3px 10px;
    border-radius: 4px;
    border: 1px solid;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.1s;
  }

  .create-bar-btn:hover {
    opacity: 0.8;
  }
</style>
