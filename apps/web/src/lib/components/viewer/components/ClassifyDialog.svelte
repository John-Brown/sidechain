<script module lang="ts">
  import type {
    StateCategory,
    IntentType,
    IntentIntensity,
    IntentValence,
  } from '@annotation/shared';

  export type ClassifyResult =
    | { type: 'states'; category: StateCategory }
    | { type: 'intents'; intent: IntentType; intensity: IntentIntensity; valence: IntentValence };
</script>

<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { TimeRange } from '@annotation/shared';
  import type { EditableType } from '../state/editor.svelte.js';

  interface Props {
    editableType: EditableType;
    /** Current values for pre-filling the form */
    currentCategory?: StateCategory;
    currentIntent?: IntentType;
    currentIntensity?: IntentIntensity;
    currentValence?: IntentValence;
    /** 1-based number shown in the title ("Reclassify intent #12") */
    ordinal?: number;
    /** Time range of the item, shown in the meta line */
    timeRange?: TimeRange;
    /** What the model predicted, when the item is still AI-sourced ("AI said inquire, 0.48") */
    aiLabel?: string;
    aiConfidence?: number | null;
    /**
     * Task mode: the categories the task allows (state categories or intent
     * types). Others stay listed but disabled. Undefined allows everything.
     */
    allowedCategories?: readonly string[] | null;
    onConfirm: (result: ClassifyResult) => void;
    onClose: () => void;
  }

  let {
    editableType,
    currentCategory,
    currentIntent,
    currentIntensity,
    currentValence,
    ordinal,
    timeRange,
    aiLabel,
    aiConfidence = null,
    allowedCategories = null,
    onConfirm,
    onClose,
  }: Props = $props();

  interface Choice {
    value: string;
    name: string;
    hue: string;
  }

  const STATE_CHOICES: Choice[] = [
    { value: 'expression.state.speaking', name: 'speaking', hue: 'hue-speaking' },
    { value: 'expression.state.listening', name: 'listening', hue: 'hue-listening' },
  ];

  const INTENT_CHOICES: Choice[] = (
    ['engage', 'inform', 'inquire', 'challenge', 'comfort', 'celebrate'] as const
  ).map((v) => ({ value: v, name: v, hue: `hue-intent-${v}` }));

  const INTENSITIES: IntentIntensity[] = ['low', 'moderate', 'high'];
  const VALENCES: IntentValence[] = ['positive', 'neutral', 'negative'];

  const isStates = $derived(editableType === 'states');
  const choices = $derived(isStates ? STATE_CHOICES : INTENT_CHOICES);
  const currentValue = $derived<string | undefined>(isStates ? currentCategory : currentIntent);
  const noun = $derived(isStates ? 'state' : 'intent');

  function isAllowed(i: number): boolean {
    const c = choices[i];
    return !!c && (!allowedCategories || allowedCategories.includes(c.value));
  }

  // Form state, seeded from the current values
  let selectedIndex = $state(0);
  let selectedIntensity = $state<IntentIntensity>('moderate');
  let selectedValence = $state<IntentValence>('neutral');

  $effect(() => {
    const i = choices.findIndex((c) => c.value === currentValue);
    const first = choices.findIndex((_, j) => isAllowed(j));
    selectedIndex = i >= 0 && isAllowed(i) ? i : Math.max(0, first);
    if (currentIntensity) selectedIntensity = currentIntensity;
    if (currentValence) selectedValence = currentValence;
  });

  const selected = $derived(choices[selectedIndex] ?? choices[0]);
  const canApply = $derived(isAllowed(selectedIndex));

  const rowEls: HTMLButtonElement[] = $state([]);

  function pad2(n: number): string {
    return n.toString().padStart(2, '0');
  }

  /** 00:59.603 */
  function fmtClock(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    return `${pad2(m)}:${s.toFixed(3).padStart(6, '0')}`;
  }

  function shortLabel(label: string): string {
    return label.startsWith('expression.state.') ? label.slice('expression.state.'.length) : label;
  }

  const meta = $derived.by(() => {
    const parts: string[] = [];
    if (timeRange) parts.push(`${fmtClock(timeRange.start)} → ${fmtClock(timeRange.end)}`);
    if (aiLabel) {
      const conf = aiConfidence != null ? `, ${aiConfidence.toFixed(2)}` : '';
      parts.push(`AI said ${shortLabel(aiLabel)}${conf}`);
    }
    return parts.join(' · ');
  });

  function pick(i: number, focus = true) {
    if (i < 0 || i >= choices.length || !isAllowed(i)) return;
    selectedIndex = i;
    if (focus) rowEls[i]?.focus();
  }

  /** Next allowed row from `from` in `delta` direction (wraps), or `from` when none. */
  function step(from: number, delta: number): number {
    const n = choices.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + delta * k) % n) + n) % n;
      if (isAllowed(i)) return i;
    }
    return from;
  }

  function apply() {
    if (!canApply) return;
    if (isStates) {
      onConfirm({ type: 'states', category: selected.value as StateCategory });
    } else if (editableType === 'intents') {
      onConfirm({
        type: 'intents',
        intent: selected.value as IntentType,
        intensity: selectedIntensity,
        valence: selectedValence,
      });
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Escape belongs to bits-ui's escape layer on document; everything else
    // stays inside the dialog so the viewer's window shortcuts don't fire.
    if (e.key === 'Escape') return;
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const target = e.target as HTMLElement | null;
    const n = Number.parseInt(e.key, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= choices.length) {
      e.preventDefault();
      pick(n - 1);
      return;
    }
    const inList = !!target?.closest('[data-classify-list]');
    if (inList && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      pick(step(selectedIndex, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter') {
      if (target?.closest('[data-classify-cancel]')) return;
      e.preventDefault();
      apply();
    }
  }
</script>

<Dialog.Root open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
  <Dialog.Portal>
    <Dialog.Overlay>
      {#snippet child({ props })}
        <div {...props} class="viewer-theme ov-overlay"></div>
      {/snippet}
    </Dialog.Overlay>
    <Dialog.Content
      onkeydown={handleKeydown}
      onEscapeKeydown={(e) => e.stopPropagation()}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        rowEls[selectedIndex]?.focus();
      }}
    >
      {#snippet child({ props })}
        <div {...props} class="viewer-theme ov-dialog">
          <div class="ov-head">
            <Dialog.Title level={2} class="font-serif ov-title">
              Reclassify {noun}{ordinal != null ? ` #${ordinal}` : ''}
            </Dialog.Title>
            {#if meta}
              <Dialog.Description class="font-mono ov-meta">{meta}</Dialog.Description>
            {/if}
          </div>

          <div class="cd-list" role="radiogroup" aria-label="Category" data-classify-list>
            {#each choices as choice, i (choice.value)}
              <button
                bind:this={rowEls[i]}
                type="button"
                role="radio"
                aria-checked={i === selectedIndex}
                aria-disabled={isAllowed(i) ? undefined : 'true'}
                tabindex={i === selectedIndex ? 0 : -1}
                class="cd-row"
                onclick={() => pick(i)}
              >
                <span class="font-mono cd-key">{i + 1}</span>
                <span class="cd-swatch {choice.hue}"></span>
                <span>{choice.name}</span>
                {#if choice.value === currentValue}
                  <span class="font-mono cd-note">current</span>
                {:else if !isAllowed(i)}
                  <span class="font-mono cd-note">not in task</span>
                {/if}
              </button>
            {/each}
          </div>

          {#if !isStates}
            <div class="cd-attrs">
              {#snippet segmented(label: string, options: string[], value: string, set: (v: string) => void)}
                <div class="cd-attr">
                  <span class="font-mono cd-attr-label">{label}</span>
                  <div class="cd-seg" role="radiogroup" aria-label={label}>
                    {#each options as opt (opt)}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={opt === value}
                        class="font-mono cd-seg-btn"
                        onclick={() => set(opt)}
                      >{opt}</button>
                    {/each}
                  </div>
                </div>
              {/snippet}
              {@render segmented('Intensity', INTENSITIES, selectedIntensity, (v) => (selectedIntensity = v as IntentIntensity))}
              {@render segmented('Valence', VALENCES, selectedValence, (v) => (selectedValence = v as IntentValence))}
            </div>
          {/if}

          <div class="ov-foot">
            <button type="button" class="font-mono ov-btn ov-btn-secondary" data-classify-cancel onclick={onClose}>
              Cancel <span class="ov-kbd">esc</span>
            </button>
            <button type="button" class="font-mono ov-btn ov-btn-primary" disabled={!canApply} onclick={apply}>
              Apply {selected.name} <span class="ov-kbd">↵</span>
            </button>
          </div>
        </div>
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  /* Shared overlay recipe: surface, 1px border, 2px amber top stripe, 2px radius, no shadow */
  .ov-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background-color: color-mix(in srgb, var(--viewer-bg) 70%, transparent);
  }

  .ov-dialog {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 101;
    width: min(360px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    background-color: var(--viewer-surface);
    color: var(--viewer-text);
    border: 1px solid var(--viewer-border);
    border-top: 2px solid var(--viewer-ornament);
    border-radius: 2px;
    outline: none;
  }

  .ov-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--viewer-border);
  }

  .ov-dialog :global(.ov-title) {
    margin: 0;
    font-size: 20px;
    font-weight: 400;
    line-height: 1.2;
  }

  .ov-dialog :global(.ov-meta) {
    margin: 0;
    font-size: 11px;
    color: var(--viewer-text-dim);
  }

  .ov-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--viewer-border);
  }

  .ov-btn {
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    border-radius: 2px;
    border: 1px solid transparent;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background-color 150ms, border-color 150ms, color 150ms;
  }

  .ov-btn-secondary {
    background: transparent;
    border-color: var(--viewer-border);
    color: var(--viewer-text-dim);
  }
  .ov-btn-secondary:hover {
    color: var(--viewer-text);
    border-color: var(--viewer-text-subtle);
  }
  .ov-btn-secondary .ov-kbd {
    color: var(--viewer-text-subtle);
  }

  .ov-btn-primary {
    background-color: var(--viewer-accent);
    color: var(--viewer-accent-fg);
  }
  .ov-btn-primary:hover:not(:disabled) {
    background-color: var(--viewer-accent-hover);
  }
  .ov-btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ov-btn-primary .ov-kbd {
    opacity: 0.75;
  }

  .ov-btn:focus-visible {
    outline: 2px solid var(--viewer-accent);
    outline-offset: 2px;
  }

  /* Category list */
  .cd-list {
    padding: 6px 0;
  }

  .cd-row {
    width: 100%;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    border: none;
    background: transparent;
    color: var(--viewer-text);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background-color 150ms;
  }
  .cd-row:hover:not([aria-disabled='true']) {
    background-color: var(--viewer-surface-2);
  }
  .cd-row[aria-disabled='true'] {
    color: var(--viewer-text-subtle);
    cursor: not-allowed;
  }
  .cd-row[aria-disabled='true'] .cd-swatch {
    opacity: 0.45;
  }
  .cd-row[aria-checked='true'] {
    background-color: var(--viewer-accent-bg);
    outline: 2px solid var(--viewer-accent);
    outline-offset: -2px;
  }
  .cd-row:focus-visible {
    outline: 2px solid var(--viewer-accent);
    outline-offset: -2px;
  }

  .cd-key {
    width: 10px;
    font-size: 11px;
    color: var(--viewer-text-dim);
  }

  .cd-swatch {
    width: 10px;
    height: 10px;
    flex: none;
    background-color: color-mix(in srgb, var(--h) var(--blk-human-bg), transparent);
    border: 1px solid var(--h);
  }

  .cd-note {
    margin-left: auto;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--viewer-text-dim);
  }

  /* Intensity / valence */
  .cd-attrs {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--viewer-border);
  }

  .cd-attr {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .cd-attr-label {
    width: 72px;
    flex: none;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--viewer-text-dim);
  }

  .cd-seg {
    display: flex;
    flex: 1;
  }

  .cd-seg-btn {
    flex: 1;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--viewer-border);
    background: transparent;
    color: var(--viewer-text-dim);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background-color 150ms, border-color 150ms, color 150ms;
  }
  .cd-seg-btn + .cd-seg-btn {
    margin-left: -1px;
  }
  .cd-seg-btn:first-child {
    border-radius: 2px 0 0 2px;
  }
  .cd-seg-btn:last-child {
    border-radius: 0 2px 2px 0;
  }
  .cd-seg-btn:hover {
    color: var(--viewer-text);
  }
  .cd-seg-btn[aria-checked='true'] {
    position: relative;
    background-color: var(--viewer-accent-bg);
    border-color: var(--viewer-accent);
    color: var(--viewer-text);
  }
  .cd-seg-btn:focus-visible {
    position: relative;
    outline: 2px solid var(--viewer-accent);
    outline-offset: 1px;
  }
</style>
