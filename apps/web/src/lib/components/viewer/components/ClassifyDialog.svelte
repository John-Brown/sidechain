<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    StateCategory,
    IntentType,
    IntentIntensity,
    IntentValence,
  } from '@annotation/shared';
  import type { EditableType } from '../state/editor.svelte.js';
  import { createDialogA11y } from '../utils/focus-trap';

  type ClassifyResult =
    | { type: 'states'; category: StateCategory }
    | { type: 'intents'; intent: IntentType; intensity: IntentIntensity; valence: IntentValence };

  interface Props {
    editableType: EditableType;
    /** Current values for pre-filling the form */
    currentCategory?: StateCategory;
    currentIntent?: IntentType;
    currentIntensity?: IntentIntensity;
    currentValence?: IntentValence;
    onConfirm: (result: ClassifyResult) => void;
    onClose: () => void;
  }

  let {
    editableType,
    currentCategory,
    currentIntent,
    currentIntensity,
    currentValence,
    onConfirm,
    onClose,
  }: Props = $props();

  // State form
  let selectedCategory = $state<StateCategory>('expression.state.speaking');

  // Intent form
  let selectedIntent = $state<IntentType>('engage');
  let selectedIntensity = $state<IntentIntensity>('moderate');
  let selectedValence = $state<IntentValence>('neutral');

  // Sync initial values from props
  $effect(() => {
    if (currentCategory) selectedCategory = currentCategory;
    if (currentIntent) selectedIntent = currentIntent;
    if (currentIntensity) selectedIntensity = currentIntensity;
    if (currentValence) selectedValence = currentValence;
  });

  const stateCategories: { value: StateCategory; label: string }[] = [
    { value: 'expression.state.speaking', label: 'Speaking' },
    { value: 'expression.state.listening', label: 'Listening' },
  ];

  const intentTypes: { value: IntentType; label: string }[] = [
    { value: 'engage', label: 'Engage' },
    { value: 'inform', label: 'Inform' },
    { value: 'inquire', label: 'Inquire' },
    { value: 'challenge', label: 'Challenge' },
    { value: 'comfort', label: 'Comfort' },
    { value: 'celebrate', label: 'Celebrate' },
  ];

  const intensityLevels: { value: IntentIntensity; label: string }[] = [
    { value: 'low', label: 'Low' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'high', label: 'High' },
  ];

  const valenceLevels: { value: IntentValence; label: string }[] = [
    { value: 'positive', label: 'Positive' },
    { value: 'neutral', label: 'Neutral' },
    { value: 'negative', label: 'Negative' },
  ];

  let dialogEl: HTMLDivElement;

  onMount(() => {
    return createDialogA11y(dialogEl, onClose);
  });

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleConfirm() {
    if (editableType === 'states') {
      onConfirm({ type: 'states', category: selectedCategory });
    } else if (editableType === 'intents') {
      onConfirm({
        type: 'intents',
        intent: selectedIntent,
        intensity: selectedIntensity,
        valence: selectedValence,
      });
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="classify-backdrop" onclick={handleBackdropClick} role="presentation">
  <div bind:this={dialogEl} class="classify-dialog" role="dialog" aria-label="Classify annotation" aria-modal="true">
    <div class="classify-header">
      <h3 class="classify-title">
        {editableType === 'states' ? 'Classify State' : 'Classify Intent'}
      </h3>
      <button class="classify-close" onclick={onClose} aria-label="Close">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>

    <div class="classify-body">
      {#if editableType === 'states'}
        <fieldset class="classify-field">
          <legend class="classify-label">Category</legend>
          <div class="classify-options">
            {#each stateCategories as cat}
              <label class="classify-option" class:classify-option-selected={selectedCategory === cat.value}>
                <input
                  type="radio"
                  name="category"
                  value={cat.value}
                  checked={selectedCategory === cat.value}
                  onchange={() => selectedCategory = cat.value}
                  class="sr-only"
                />
                <span class="block-{cat.value === 'expression.state.speaking' ? 'speaking' : 'listening'} classify-chip">
                  {cat.label}
                </span>
              </label>
            {/each}
          </div>
        </fieldset>
      {:else if editableType === 'intents'}
        <fieldset class="classify-field">
          <legend class="classify-label">Intent Type</legend>
          <div class="classify-options classify-options-grid">
            {#each intentTypes as intent}
              <label class="classify-option" class:classify-option-selected={selectedIntent === intent.value}>
                <input
                  type="radio"
                  name="intent"
                  value={intent.value}
                  checked={selectedIntent === intent.value}
                  onchange={() => selectedIntent = intent.value}
                  class="sr-only"
                />
                <span class="block-intent-{intent.value} classify-chip">
                  {intent.label}
                </span>
              </label>
            {/each}
          </div>
        </fieldset>

        <fieldset class="classify-field">
          <legend class="classify-label">Intensity</legend>
          <div class="classify-options">
            {#each intensityLevels as level}
              <label class="classify-option" class:classify-option-selected={selectedIntensity === level.value}>
                <input
                  type="radio"
                  name="intensity"
                  value={level.value}
                  checked={selectedIntensity === level.value}
                  onchange={() => selectedIntensity = level.value}
                  class="sr-only"
                />
                <span class="classify-chip-plain">{level.label}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <fieldset class="classify-field">
          <legend class="classify-label">Valence</legend>
          <div class="classify-options">
            {#each valenceLevels as level}
              <label class="classify-option" class:classify-option-selected={selectedValence === level.value}>
                <input
                  type="radio"
                  name="valence"
                  value={level.value}
                  checked={selectedValence === level.value}
                  onchange={() => selectedValence = level.value}
                  class="sr-only"
                />
                <span class="classify-chip-plain">{level.label}</span>
              </label>
            {/each}
          </div>
        </fieldset>
      {/if}
    </div>

    <div class="classify-footer">
      <button class="classify-btn classify-btn-cancel" onclick={onClose}>Cancel</button>
      <button class="classify-btn classify-btn-confirm" onclick={handleConfirm}>Apply</button>
    </div>
  </div>
</div>

<style>
  .classify-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
  }

  .classify-dialog {
    width: 340px;
    max-height: 80vh;
    overflow-y: auto;
    border-radius: 8px;
    border: 1px solid var(--viewer-border);
    background: var(--viewer-surface);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .classify-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--viewer-border);
  }

  .classify-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--viewer-text);
    margin: 0;
  }

  .classify-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--viewer-text-dim);
    cursor: pointer;
  }

  .classify-close:hover {
    background: var(--viewer-surface-2);
    color: var(--viewer-text);
  }

  .classify-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .classify-field {
    border: none;
    margin: 0;
    padding: 0;
  }

  .classify-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--viewer-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
    display: block;
  }

  .classify-options {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .classify-options-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }

  .classify-option {
    cursor: pointer;
  }

  .classify-option-selected .classify-chip,
  .classify-option-selected .classify-chip-plain {
    outline: 2px solid var(--viewer-accent);
    outline-offset: 1px;
  }

  .classify-chip {
    display: block;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid;
    font-size: 12px;
    text-align: center;
    user-select: none;
  }

  .classify-chip-plain {
    display: block;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid var(--viewer-border);
    background: var(--viewer-bg);
    color: var(--viewer-text);
    font-size: 12px;
    text-align: center;
    user-select: none;
  }

  .classify-chip-plain:hover {
    background: var(--viewer-surface-2);
  }

  .classify-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--viewer-border);
  }

  .classify-btn {
    padding: 6px 16px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .classify-btn-cancel {
    background: transparent;
    color: var(--viewer-text-dim);
    border-color: var(--viewer-border);
  }

  .classify-btn-cancel:hover {
    background: var(--viewer-surface-2);
    color: var(--viewer-text);
  }

  .classify-btn-confirm {
    background: var(--viewer-accent);
    color: white;
    border-color: var(--viewer-accent);
  }

  .classify-btn-confirm:hover {
    opacity: 0.9;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
