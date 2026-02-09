<script lang="ts">
  import { getTimelineState, getEditorState } from '../context.js';
  import type { EditableType } from '../state/editor.svelte.js';
  import type {
    StateAnnotation,
    IntentAnnotation,
    BackchannelAnnotation,
    UserLabel,
  } from '@annotation/shared';
  import { createAnnotation } from '../editing/operations.js';
  import { validateTimeRange, checkOverlap } from '../editing/time-validation.js';

  const timeline = getTimelineState();
  const editor = getEditorState();

  const DEFAULT_DURATION = 1; // seconds

  function createState() {
    if (!editor.states) return;
    const range = makeRange();
    if (!canCreate(editor.states, range)) return;

    const newItem: StateAnnotation = {
      time_range: range,
      category: 'expression.state.speaking',
      note: '',
      parameters: {},
    };

    pushUndo('states');
    editor.states = createAnnotation(editor.states, newItem);
    editor.lastEditedType = 'states';
    editor.markDirty('states');
  }

  function createIntent() {
    if (!editor.intents) return;
    const range = makeRange();
    if (!canCreate(editor.intents, range)) return;

    const newItem: IntentAnnotation = {
      time_range: range,
      intent_classification: {
        intent: 'engage',
        intensity: 'moderate',
        valence: 'neutral',
        confidence: 1.0,
        reasoning: 'Manually created',
      },
    };

    pushUndo('intents');
    editor.intents = createAnnotation(editor.intents, newItem);
    editor.lastEditedType = 'intents';
    editor.markDirty('intents');
  }

  function createBackchannel() {
    if (!editor.backchannels) {
      editor.backchannels = [];
    }
    const range = makeRange();
    if (!canCreate(editor.backchannels, range)) return;

    const newItem: BackchannelAnnotation = {
      time_range: range,
      backchannel: {
        type: 'acknowledgment',
        speaker: 'SPEAKER_00',
        note: '',
      },
    };

    pushUndo('backchannels');
    editor.backchannels = createAnnotation(editor.backchannels, newItem);
    editor.lastEditedType = 'backchannels';
    editor.markDirty('backchannels');
  }

  function createUserLabel() {
    if (!editor.userLabels) {
      editor.userLabels = [];
    }
    const range = makeRange();
    if (!canCreate(editor.userLabels, range)) return;

    const newItem: UserLabel = {
      time_range: range,
      text: 'Label',
    };

    pushUndo('userLabels');
    editor.userLabels = createAnnotation(editor.userLabels, newItem);
    editor.lastEditedType = 'userLabels';
    editor.markDirty('userLabels');
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

  function pushUndo(type: EditableType) {
    const currentArray = editor[type];
    if (!currentArray) return;
    // $state.snapshot() unwraps Svelte 5 proxies before structuredClone
    switch (type) {
      case 'states':
        editor.stateHistory.push(structuredClone($state.snapshot(editor.states!)));
        break;
      case 'intents':
        editor.intentHistory.push(structuredClone($state.snapshot(editor.intents!)));
        break;
      case 'transcription':
        editor.transcriptionHistory.push(structuredClone($state.snapshot(editor.transcription!)));
        break;
      case 'backchannels':
        editor.backchannelHistory.push(structuredClone($state.snapshot(editor.backchannels!)));
        break;
      case 'userLabels':
        editor.userLabelHistory.push(structuredClone($state.snapshot(editor.userLabels!)));
        break;
    }
  }
</script>

{#if editor.editing}
  <div class="create-bar">
    <span class="create-bar-label">Add at playhead:</span>
    {#if editor.states !== null}
      <button class="create-bar-btn block-speaking" onclick={createState} title="Create state annotation (N)">
        State
      </button>
    {/if}
    {#if editor.intents !== null}
      <button class="create-bar-btn block-intent-engage" onclick={createIntent} title="Create intent annotation">
        Intent
      </button>
    {/if}
    <button class="create-bar-btn" onclick={createBackchannel} title="Create backchannel annotation">
      Backchannel
    </button>
    <button class="create-bar-btn block-user-label" onclick={createUserLabel} title="Create label at playhead">
      Label
    </button>
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
