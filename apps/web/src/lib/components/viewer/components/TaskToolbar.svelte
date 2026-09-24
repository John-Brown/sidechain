<script lang="ts">
  import { getEditorState, getTaskModeState } from '../context.js';
  import type { AnnotationSetType, EditType } from '@annotation/shared';

  interface Props {
    /** Defaults to editor.undo(). */
    onUndo?: () => void;
    /** Defaults to editor.redo(). */
    onRedo?: () => void;
  }

  let { onUndo, onRedo }: Props = $props();

  const editor = getEditorState();
  const taskMode = getTaskModeState();

  const TYPE_INFO: Record<AnnotationSetType, { label: string; hue: string }> = {
    state: { label: 'States', hue: 'hue-speaking' },
    intent: { label: 'Intents', hue: 'hue-intent-inquire' },
    backchannel: { label: 'Backchannels', hue: 'hue-backchannel' },
    transcription: { label: 'Transcription', hue: 'hue-spk-0' },
    user_labels: { label: 'Labels', hue: 'hue-label' },
    session_bounds: { label: 'Session bounds', hue: 'hue-listening' },
  };

  /** Operations the toolbar reports on, in display order. */
  const OPS: { op: EditType; label: string; key: string }[] = [
    { op: 'confirm', label: 'Confirm', key: '↵' },
    { op: 'classify', label: 'Reclassify', key: 'C' },
    { op: 'resize', label: 'Resize', key: 'drag' },
    { op: 'create', label: 'Create', key: '' },
    { op: 'split', label: 'Split', key: 'S' },
    { op: 'merge', label: 'Merge', key: 'M' },
    { op: 'delete', label: 'Delete', key: '⌫' },
  ];

  const editableTypes = $derived(taskMode.constraints?.editableTypes ?? []);
  const allowed = $derived(OPS.filter((o) => taskMode.isOperationAllowed(o.op)));
  const notAllowed = $derived(OPS.filter((o) => !taskMode.isOperationAllowed(o.op)));
  const locked = $derived(taskMode.lockedTimeRanges);

  const MAX_RANGES_SHOWN = 3;

  function fmtS(t: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m.toString().padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }

  const lockedSummary = $derived(
    locked
      .slice(0, MAX_RANGES_SHOWN)
      .map((r) => `${fmtS(r.start)}–${fmtS(r.end)}`)
      .join(' · ') + (locked.length > MAX_RANGES_SHOWN ? ` · +${locked.length - MAX_RANGES_SHOWN}` : ''),
  );

  const undo = () => (onUndo ? onUndo() : editor.undo());
  const redo = () => (onRedo ? onRedo() : editor.redo());
  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
</script>

{#if taskMode.active}
  <div class="task-toolbar" role="toolbar" aria-label="Task toolbar">
    <span class="tb-tag">Task</span>

    <span class="tb-caption tb-caption-lead">Editable</span>
    {#each editableTypes as type (type)}
      <span class="tb-chip">
        <span class="tb-swatch {TYPE_INFO[type]?.hue ?? 'hue-listening'}" aria-hidden="true"></span>
        {TYPE_INFO[type]?.label ?? type}
      </span>
    {:else}
      <span class="tb-muted">None</span>
    {/each}

    <div class="tb-divider" aria-hidden="true"></div>

    <span class="tb-caption">Allowed</span>
    {#each allowed as o (o.op)}
      <span class="tb-chip tb-chip-allowed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        {o.label}
        {#if o.key}<span class="tb-key" aria-hidden="true">{o.key}</span>{/if}
      </span>
    {:else}
      <span class="tb-muted">None</span>
    {/each}

    {#if notAllowed.length > 0}
      <span class="tb-caption tb-caption-gap">Not in this task</span>
      <s class="tb-struck">{notAllowed.map((o) => o.label).join(' · ')}</s>
    {/if}

    {#if locked.length > 0}
      <div class="tb-divider" aria-hidden="true"></div>
      <span class="tb-locked">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        {locked.length} locked {locked.length === 1 ? 'range' : 'ranges'}
        <span class="tb-mono">{lockedSummary}</span>
      </span>
    {/if}

    <div class="flex-1"></div>

    <div class="tb-history">
      <button type="button" class="tb-icon-btn" onclick={undo} disabled={!editor.canUndo} aria-label="Undo" title="Undo ({modKey}Z)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
      </button>
      <button type="button" class="tb-icon-btn" onclick={redo} disabled={!editor.canRedo} aria-label="Redo" title="Redo ({modKey}⇧Z)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .task-toolbar {
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

  .tb-caption-gap {
    margin-left: 8px;
  }

  .tb-divider {
    flex: none;
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background-color: var(--viewer-border);
  }

  /* Read-only chips: same box as the edit toolbar buttons, not interactive */
  .tb-chip {
    height: 24px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    box-sizing: border-box;
    background-color: var(--viewer-surface);
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
  }

  .tb-chip-allowed {
    color: var(--viewer-accent);
    border-color: var(--viewer-accent);
  }

  /* 8px hue swatch: AI fill + solid hue border (--h comes from the hue-* class) */
  .tb-swatch {
    width: 8px;
    height: 8px;
    flex: none;
    box-sizing: border-box;
    background-color: color-mix(in srgb, var(--h) var(--blk-ai-bg), transparent);
    border: 1px solid var(--h);
  }

  .tb-key {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--viewer-text-subtle);
  }

  .tb-muted {
    color: var(--viewer-text-dim);
  }

  .tb-struck {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--viewer-text-subtle);
    text-decoration: line-through;
  }

  .tb-locked {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--viewer-text-dim);
  }

  .tb-mono {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--viewer-text-subtle);
    overflow: hidden;
    text-overflow: ellipsis;
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
</style>
