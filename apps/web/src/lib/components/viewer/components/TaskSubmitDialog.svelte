<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { TimeRange } from '@annotation/shared';

  interface Props {
    editCount: number;
    elapsedSecs: number;
    /** Human-readable coverage problems (validateCoverage().errors). */
    coverageErrors: string[];
    /** Coverage gaps as time ranges. When given, rows show the range and "Jump to gap" seeks to the first one. */
    coverageGaps?: TimeRange[];
    /** Review progress row, e.g. 46 / 46 */
    reviewedCount?: number;
    totalReviewable?: number;
    /** Label for the review row (default "Intents reviewed") */
    reviewedLabel?: string;
    /** False when the task reviews neither intents nor words: the review row reads N/A */
    reviewApplicable?: boolean;
    /** Who reviews the submission ("M. Okafor will see this in their review queue.") */
    reviewerName?: string | null;
    /** Seek to a gap. The dialog closes (onCancel) right after calling it. */
    onJumpToGap?: (time: number) => void;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let {
    editCount,
    elapsedSecs,
    coverageErrors,
    coverageGaps = [],
    reviewedCount,
    totalReviewable,
    reviewedLabel = 'Intents reviewed',
    reviewApplicable = true,
    reviewerName = null,
    onJumpToGap,
    onConfirm,
    onCancel,
  }: Props = $props();

  const hasGaps = $derived(coverageGaps.length > 0);
  const hasCoverageIssues = $derived(hasGaps || coverageErrors.length > 0);
  const canJump = $derived(hasGaps && !!onJumpToGap);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
  const submitKey = isMac ? '⌘↵' : 'Ctrl↵';

  function pad2(n: number): string {
    return n.toString().padStart(2, '0');
  }

  /** 08:02, same as the header's task timer */
  function fmtClock(secs: number): string {
    const s = Math.max(0, Math.floor(secs));
    return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  }

  /** 02:14.2 */
  function fmtTenths(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    return `${pad2(m)}:${s.toFixed(1).padStart(4, '0')}`;
  }

  function jumpToGap() {
    if (!hasGaps || !onJumpToGap) return;
    onJumpToGap(coverageGaps[0].start);
    onCancel();
  }

  function handleKeydown(e: KeyboardEvent) {
    // Escape belongs to bits-ui's escape layer; keep the rest away from the viewer shortcuts.
    if (e.key === 'Escape') return;
    e.stopPropagation();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!hasCoverageIssues) onConfirm();
    }
  }
</script>

<Dialog.Root open={true} onOpenChange={(open) => { if (!open) onCancel(); }}>
  <Dialog.Portal>
    <Dialog.Overlay>
      {#snippet child({ props })}
        <div {...props} class="viewer-theme ov-overlay"></div>
      {/snippet}
    </Dialog.Overlay>
    <Dialog.Content onkeydown={handleKeydown} onEscapeKeydown={(e) => e.stopPropagation()}>
      {#snippet child({ props })}
        <div {...props} class="viewer-theme ov-dialog">
          <div class="ov-head">
            <Dialog.Title level={2} class="font-serif ov-title">Submit for review?</Dialog.Title>
            <Dialog.Description class="ov-sub">
              {reviewerName
                ? `${reviewerName} will see this in their review queue.`
                : 'A reviewer will see this in their review queue.'}
            </Dialog.Description>
          </div>

          <dl class="ts-rows">
            {#if !reviewApplicable}
              <dt>{reviewedLabel}</dt>
              <dd class="font-mono">N/A</dd>
            {:else if totalReviewable != null}
              <dt>{reviewedLabel}</dt>
              <dd class="font-mono">{reviewedCount ?? 0} / {totalReviewable}</dd>
            {/if}
            <dt>Edits</dt>
            <dd class="font-mono">{editCount}</dd>
            <dt>Time spent</dt>
            <dd class="font-mono">{fmtClock(elapsedSecs)}</dd>
            {#if hasGaps}
              {#each coverageGaps as gap}
                <dt class="ts-danger">Coverage gap</dt>
                <dd class="font-mono ts-danger">{fmtTenths(gap.start)} – {fmtTenths(gap.end)}</dd>
              {/each}
            {:else}
              {#each coverageErrors as error}
                <dt class="ts-danger">Coverage</dt>
                <dd class="font-mono ts-danger">{error}</dd>
              {/each}
            {/if}
          </dl>

          {#if hasCoverageIssues}
            <div class="ts-info">States must cover the whole video. Fix the gap before you submit.</div>
          {/if}

          <div class="ov-foot">
            {#if canJump}
              <button type="button" class="font-mono ov-btn ov-btn-secondary" onclick={jumpToGap}>
                Jump to gap
              </button>
            {:else}
              <button type="button" class="font-mono ov-btn ov-btn-secondary" onclick={onCancel}>
                Cancel <span class="ov-kbd">esc</span>
              </button>
            {/if}
            <button
              type="button"
              class="font-mono ov-btn ov-btn-primary"
              disabled={hasCoverageIssues}
              title={hasCoverageIssues ? 'Fix the coverage gap first' : undefined}
              onclick={onConfirm}
            >
              Submit <span class="ov-kbd">{submitKey}</span>
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
    width: min(400px, calc(100vw - 32px));
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

  .ov-dialog :global(.ov-sub) {
    margin: 0;
    font-size: 12px;
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

  .ts-rows {
    display: grid;
    grid-template-columns: 1fr auto;
    row-gap: 8px;
    column-gap: 16px;
    margin: 0;
    padding: 12px 16px;
    font-size: 13px;
  }

  .ts-rows dt,
  .ts-rows dd {
    margin: 0;
  }

  .ts-rows dd {
    font-size: 12px;
    text-align: right;
  }

  .ts-danger {
    color: var(--viewer-danger);
  }

  /* InfoBox: 4px amber left border */
  .ts-info {
    margin: 0 16px 12px;
    padding: 8px 10px;
    border: 1px solid var(--viewer-border);
    border-left: 4px solid var(--viewer-ornament);
    background-color: var(--viewer-surface-2);
    font-size: 12px;
    line-height: 1.45;
  }
</style>
