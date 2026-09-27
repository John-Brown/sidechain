<script lang="ts">
  import type {
    AnnotationSetType,
    BackchannelAnnotation,
    DiarizationSegment,
    IntentAnnotation,
    SpeechWord,
    StateAnnotation,
    TimeRange,
    UserLabel,
  } from '@annotation/shared';
  import {
    getAnnotationDataState,
    getEditorState,
    getSessionState,
    getTaskModeState,
  } from './context.js';
  import type { EditableType } from './state/editor.svelte.js';
  import type { TranscriptionSegment } from './utils/group-words.js';
  import {
    LOW_CONFIDENCE,
    getProvenance,
    isConfirmed,
    isLowConfidence,
    type ReviewableAnnotation,
  } from './review.js';

  interface Props {
    /** ↵ / "Confirm": accept the selected AI prediction unchanged (edit + task mode) */
    onConfirm?: () => void;
    /** C / "Reclassify": open the classify dialog for the selection (edit + task mode) */
    onReclassify?: () => void;
  }

  let { onConfirm, onReclassify }: Props = $props();

  const session = getSessionState();
  const editor = getEditorState();
  const annotations = getAnnotationDataState();
  const taskMode = getTaskModeState();

  type Kind = 'intent' | 'state' | 'word' | 'segment' | 'label' | 'diarization' | 'backchannel' | 'unknown';

  interface Selection {
    kind: Kind;
    item: Record<string, unknown> & { time_range?: TimeRange };
    /** 0-based index in its track, or null when it can't be resolved */
    index: number | null;
    /** Set when the selection comes from the editor (edit/task mode) */
    editableType: EditableType | null;
  }

  const KIND_TITLES: Record<Kind, string> = {
    intent: 'Intent',
    state: 'State',
    word: 'Word',
    segment: 'Segment',
    label: 'Label',
    diarization: 'Turn',
    backchannel: 'Backchannel',
    unknown: 'Item',
  };

  const EDITABLE_KIND: Record<EditableType, Kind> = {
    intents: 'intent',
    states: 'state',
    transcription: 'word',
    userLabels: 'label',
    backchannels: 'backchannel',
  };

  const EDITABLE_SET_TYPE: Record<EditableType, AnnotationSetType> = {
    intents: 'intent',
    states: 'state',
    transcription: 'transcription',
    userLabels: 'user_labels',
    backchannels: 'backchannel',
  };

  function kindOf(item: Record<string, unknown>): Kind {
    if ('intent_classification' in item) return 'intent';
    if ('category' in item) return 'state';
    if ('speech' in item) return 'word';
    if ('backchannel' in item) return 'backchannel';
    if ('diarization' in item) return 'diarization';
    if ('wordCount' in item && 'text' in item) return 'segment';
    if ('text' in item) return 'label';
    return 'unknown';
  }

  function sameRange(a: TimeRange | undefined, b: TimeRange | undefined): boolean {
    return !!a && !!b && a.start === b.start && a.end === b.end;
  }

  /** Index of a view-mode selection in its loaded track (by time range: the selection may be a proxy copy). */
  function indexIn(list: readonly { time_range: TimeRange }[] | undefined | null, range: TimeRange | undefined): number | null {
    if (!list || !range) return null;
    const i = list.findIndex((x) => sameRange(x.time_range, range));
    return i >= 0 ? i : null;
  }

  const selection = $derived.by((): Selection | null => {
    // Edit / task mode: the editor selection wins.
    const type = editor.selectedType;
    const idx = editor.selectedIndex;
    if (type !== null && idx !== null) {
      const arr = editor[type] as Record<string, unknown>[] | null;
      const item = arr?.[idx];
      if (item) return { kind: EDITABLE_KIND[type], item, index: idx, editableType: type };
    }

    const item = session.selectedAnnotation as Selection['item'] | null;
    if (!item) return null;
    const kind = kindOf(item);
    const range = item.time_range;
    let index: number | null = null;
    switch (kind) {
      case 'intent': index = indexIn(annotations.intentClassification?.data, range); break;
      case 'state': index = indexIn(annotations.stateAnnotation?.data, range); break;
      case 'word': index = indexIn(annotations.transcription?.data, range); break;
      case 'label': index = indexIn(annotations.userLabels?.data, range); break;
      case 'diarization': index = indexIn(annotations.diarization?.data, range); break;
      case 'backchannel': index = indexIn(annotations.backchannel?.data, range); break;
      case 'segment': index = typeof item.segmentIndex === 'number' ? item.segmentIndex : null; break;
    }
    return { kind, item, index, editableType: null };
  });

  const reviewable = $derived(
    selection !== null &&
      (selection.kind === 'intent' ||
        selection.kind === 'state' ||
        selection.kind === 'word' ||
        selection.kind === 'backchannel' ||
        selection.kind === 'label'),
  );

  const reviewItem = $derived(reviewable && selection ? (selection.item as unknown as ReviewableAnnotation) : null);

  // --- Per-kind view model ---

  function speakerIndex(speaker: string | number | null | undefined): number {
    if (typeof speaker === 'number') return speaker % 2;
    const m = /(\d+)\s*$/.exec(speaker ?? '');
    return m ? Number(m[1]) % 2 : 0;
  }

  function speakerShort(speaker: string | number | null | undefined): string {
    if (speaker === null || speaker === undefined || speaker === '') return '—';
    return `S${speakerIndex(speaker)}`;
  }

  const stereo = $derived(!!annotations.waveform?.peaks_r);

  function speakerLong(speaker: string | number | null | undefined): string {
    if (speaker === null || speaker === undefined || speaker === '') return '—';
    const n = speakerIndex(speaker);
    if (!stereo) return `S${n}`;
    return n === 0 ? `S${n} · left channel` : `S${n} · right channel`;
  }

  /** Speaker active at a time, from diarization (intents and states carry no speaker). */
  function speakerAt(time: number): string | null {
    const turns = annotations.diarization?.data;
    if (!turns) return null;
    const t = turns.find((d) => time >= d.time_range.start && time < d.time_range.end);
    return t?.diarization.speaker ?? null;
  }

  function hueClass(sel: Selection): string {
    const it = sel.item;
    switch (sel.kind) {
      case 'intent': return `hue-intent-${(it as unknown as IntentAnnotation).intent_classification.intent}`;
      case 'state':
        return (it as unknown as StateAnnotation).category.endsWith('speaking') ? 'hue-speaking' : 'hue-listening';
      case 'word': return `hue-spk-${speakerIndex((it as unknown as SpeechWord).speech.speaker)}`;
      case 'segment': return `hue-spk-${speakerIndex((it as unknown as TranscriptionSegment).speaker)}`;
      case 'diarization': return `hue-spk-${speakerIndex((it as unknown as DiarizationSegment).diarization.speaker)}`;
      case 'label': return 'hue-label';
      case 'backchannel': return 'hue-backchannel';
      default: return 'hue-label';
    }
  }

  function titleOf(sel: Selection): string {
    const it = sel.item;
    switch (sel.kind) {
      case 'intent': return (it as unknown as IntentAnnotation).intent_classification.intent;
      case 'state': return (it as unknown as StateAnnotation).category.split('.').pop() ?? '';
      case 'word': return `“${(it as unknown as SpeechWord).speech.word}”`;
      case 'segment': return `“${(it as unknown as TranscriptionSegment).text}”`;
      case 'label': return (it as unknown as UserLabel).text;
      case 'diarization': return `Speaker ${speakerShort((it as unknown as DiarizationSegment).diarization.speaker)}`;
      case 'backchannel': return (it as unknown as BackchannelAnnotation).backchannel.type;
      default: return KIND_TITLES.unknown;
    }
  }

  function confidenceOf(sel: Selection): number | null {
    const it = sel.item;
    if (sel.kind === 'intent') return (it as unknown as IntentAnnotation).intent_classification.confidence;
    if (sel.kind === 'word') return (it as unknown as SpeechWord).speech.confidence;
    return null;
  }

  interface Row { label: string; value: string; meta?: string; mono?: boolean }

  function runMeta(meta: { algorithm?: { model?: string; name?: string }; created_timestamp?: string } | undefined): string {
    if (!meta) return '';
    const model = meta.algorithm?.model ?? meta.algorithm?.name ?? '';
    const date = meta.created_timestamp ? meta.created_timestamp.slice(0, 10) : '';
    return [model, date ? `run ${date}` : ''].filter(Boolean).join(' · ');
  }

  function sourceRow(sel: Selection): Row | null {
    switch (sel.kind) {
      case 'intent':
        if (getProvenance(sel.item as unknown as ReviewableAnnotation) !== 'ai' && !isConfirmed(sel.item as unknown as ReviewableAnnotation)) {
          return { label: 'Source', value: 'Human' };
        }
        return { label: 'Source', value: 'intent_classification', meta: runMeta(annotations.intentClassification?.metadata) };
      case 'state':
        return { label: 'Source', value: 'state_annotation', meta: runMeta(annotations.stateAnnotation?.metadata) };
      case 'word':
      case 'segment':
        return { label: 'Source', value: 'transcription', meta: runMeta(annotations.transcription?.metadata) };
      case 'diarization':
        return { label: 'Source', value: 'diarization', meta: runMeta(annotations.diarization?.metadata) };
      case 'label':
      case 'backchannel':
        return { label: 'Source', value: 'Human' };
      default:
        return null;
    }
  }

  function rowsOf(sel: Selection): Row[] {
    const it = sel.item;
    const range = it.time_range;
    const rows: Row[] = [];
    if (range) {
      rows.push({
        label: 'Time',
        value: `${fmt(range.start)} → ${fmt(range.end)}`,
        meta: `${(range.end - range.start).toFixed(3)} s`,
        mono: true,
      });
    }
    switch (sel.kind) {
      case 'intent': {
        const ic = (it as unknown as IntentAnnotation).intent_classification;
        const spk = range ? speakerAt(range.start) : null;
        if (spk) rows.push({ label: 'Speaker', value: speakerLong(spk) });
        rows.push({ label: 'Intensity', value: `${ic.intensity} · valence ${ic.valence}` });
        break;
      }
      case 'state': {
        const st = it as unknown as StateAnnotation;
        const spk = range ? speakerAt(range.start) : null;
        if (spk) rows.push({ label: 'Speaker', value: speakerLong(spk) });
        if (st.note) rows.push({ label: 'Note', value: st.note });
        break;
      }
      case 'word': {
        const sp = (it as unknown as SpeechWord).speech;
        rows.push({ label: 'Speaker', value: speakerLong(sp.speaker) });
        rows.push({ label: 'Segment', value: `#${sp.speech_segment + 1}`, mono: true });
        break;
      }
      case 'segment': {
        const seg = it as unknown as TranscriptionSegment;
        rows.push({ label: 'Speaker', value: speakerLong(seg.speaker) });
        rows.push({ label: 'Words', value: String(seg.wordCount), mono: true });
        break;
      }
      case 'diarization':
        rows.push({ label: 'Speaker', value: speakerLong((it as unknown as DiarizationSegment).diarization.speaker) });
        break;
      case 'backchannel': {
        const bc = (it as unknown as BackchannelAnnotation).backchannel;
        rows.push({ label: 'Speaker', value: speakerLong(bc.speaker) });
        if (bc.note) rows.push({ label: 'Note', value: bc.note });
        break;
      }
    }
    const src = sourceRow(sel);
    if (src) rows.push(src);
    return rows;
  }

  /** MM:SS.fff with two-digit minutes (inspector time rows). */
  function fmt(t: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  }

  const hue = $derived(selection ? hueClass(selection) : '');
  const title = $derived(selection ? titleOf(selection) : '');
  const confidence = $derived(selection ? confidenceOf(selection) : null);
  const rows = $derived(selection ? rowsOf(selection) : []);
  const reasoning = $derived(
    selection?.kind === 'intent'
      ? (selection.item as unknown as IntentAnnotation).intent_classification.reasoning || null
      : null,
  );
  const provenance = $derived(
    reviewItem ? getProvenance(reviewItem) : selection && selection.kind !== 'unknown' ? 'ai' : null,
  );
  const confirmed = $derived(reviewItem ? isConfirmed(reviewItem) : false);
  const lowConf = $derived(reviewItem ? isLowConfidence(reviewItem) : false);

  const badge = $derived.by(() => {
    if (!provenance) return null;
    if (provenance === 'supervisor_override') return 'Supervisor';
    if (provenance === 'human') return confirmed ? 'Confirmed' : 'Human';
    return reviewable ? 'AI · unreviewed' : 'AI';
  });

  // --- Actions (edit + task mode) ---

  const actionsVisible = $derived(editor.editing || taskMode.active);

  /** Task constraints on the editor selection: type editable, operation allowed, not in a locked range. */
  function taskAllows(op: 'confirm' | 'classify'): boolean {
    if (!taskMode.active || !selection?.editableType) return true;
    if (!taskMode.isTypeEditable(EDITABLE_SET_TYPE[selection.editableType])) return false;
    if (!taskMode.isOperationAllowed(op)) return false;
    const range = selection.item.time_range;
    return !(range && taskMode.isTimeLocked(range));
  }

  const canConfirm = $derived(
    editor.editing &&
      selection?.editableType != null &&
      provenance === 'ai' &&
      taskAllows('confirm'),
  );

  const canReclassify = $derived(
    editor.editing &&
      selection?.editableType != null &&
      (selection.kind === 'intent' || selection.kind === 'state') &&
      taskAllows('classify'),
  );

  const confirmTitle = $derived.by(() => {
    if (!selection?.editableType) return 'Select a block on an editable track';
    if (provenance !== 'ai') return 'Already reviewed';
    if (!taskAllows('confirm')) return 'Not allowed in this task';
    return 'Accept the prediction unchanged';
  });

  const rawJson = $derived(selection ? JSON.stringify(selection.item, null, 2) : '');
</script>

<section class="h-full min-h-0 flex flex-col bg-viewer-surface text-viewer-text" aria-label="Inspector">
  <header
    class="h-8 flex-none flex items-center gap-2 px-4 border-b border-viewer-border font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim"
  >
    Inspector<span class="ornament" aria-hidden="true">◆</span>
    {#if selection}
      <span class="text-viewer-text-subtle">
        {KIND_TITLES[selection.kind]}{selection.index !== null ? ` #${selection.index + 1}` : ''}
      </span>
    {/if}
  </header>

  {#if selection}
    <div class="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 flex flex-col gap-3">
      <!-- Identity: swatch, serif label, provenance badge -->
      <div class="flex items-center gap-2.5 min-w-0">
        <span
          class="swatch blk {hue}"
          data-source={provenance ?? 'ai'}
          data-lowconf={lowConf ? '' : undefined}
          aria-hidden="true"
        ></span>
        <span class="font-serif text-2xl leading-none truncate min-w-0" title={title}>{title}</span>
        <div class="flex-1"></div>
        {#if badge}
          <span
            class="h-5 flex-none flex items-center gap-1 px-[7px] border border-viewer-border rounded-sm font-mono text-viewer-xs uppercase tracking-label {provenance === 'ai' ? 'text-viewer-text-dim' : 'text-viewer-text'}"
          >
            {#if confirmed}<span class="text-viewer-accent" aria-hidden="true">✓</span>{/if}{badge}
          </span>
        {/if}
      </div>

      <!-- Confidence bar with the LOW_CONFIDENCE tick -->
      {#if confidence !== null}
        <div class="flex flex-col gap-1.5 {hue}">
          <div class="flex items-baseline justify-between">
            <span class="font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim">Confidence</span>
            <span class="font-mono text-viewer-md text-viewer-text">
              {confidence.toFixed(2)}
              {#if confidence < LOW_CONFIDENCE}
                <span class="text-viewer-sm text-viewer-text-dim">below {LOW_CONFIDENCE.toFixed(2)}</span>
              {/if}
            </span>
          </div>
          <div
            class="conf-bar"
            role="meter"
            aria-label="Confidence"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={confidence}
          >
            <div class="conf-fill" style:width="{Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%"></div>
            <div class="conf-tick" style:left="{LOW_CONFIDENCE * 100}%" title="Low-confidence threshold {LOW_CONFIDENCE.toFixed(2)}"></div>
          </div>
        </div>
      {/if}

      <!-- Time / Speaker / Intensity / Source -->
      <dl class="grid grid-cols-[96px_1fr] gap-y-1.5 items-baseline text-viewer-base">
        {#each rows as row (row.label)}
          <dt class="font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim">{row.label}</dt>
          <dd class="min-w-0 break-words {row.mono ? 'font-mono' : ''}">
            {row.value}
            {#if row.meta}
              <span class="font-mono text-viewer-sm text-viewer-text-subtle">{row.meta}</span>
            {/if}
          </dd>
        {/each}
      </dl>

      {#if reasoning}
        <div class="px-3 py-2.5 bg-viewer-surface-2 border border-viewer-border text-viewer-base leading-normal text-viewer-text-dim">
          <span class="block mb-1 font-mono text-viewer-xs uppercase tracking-label text-viewer-text-subtle">Model reasoning</span>
          {reasoning}
        </div>
      {/if}

      <details class="raw">
        <summary class="font-mono text-viewer-xs uppercase tracking-label text-viewer-text-dim cursor-pointer select-none">
          Raw JSON
        </summary>
        <pre class="mt-1.5 p-2 bg-viewer-surface-2 border border-viewer-border font-mono text-viewer-xs leading-normal whitespace-pre-wrap break-all text-viewer-text">{rawJson}</pre>
      </details>

      <div class="flex-1"></div>

      {#if actionsVisible}
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-primary font-mono text-viewer-sm uppercase tracking-label"
            disabled={!canConfirm}
            title={confirmTitle}
            onclick={() => onConfirm?.()}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>
            Confirm <span class="opacity-75" aria-hidden="true">↵</span>
          </button>
          {#if selection.kind === 'intent' || selection.kind === 'state'}
            <button
              type="button"
              class="btn btn-outline font-mono text-viewer-sm uppercase tracking-label"
              disabled={!canReclassify}
              title={canReclassify ? 'Pick another category' : 'Not allowed here'}
              onclick={() => onReclassify?.()}
            >
              Reclassify <span class="text-viewer-text-subtle" aria-hidden="true">C</span>
            </button>
          {/if}
        </div>
      {:else}
        <p class="text-viewer-base text-viewer-text-dim">
          Read-only. Press <kbd class="font-mono text-viewer-sm">⌘E</kbd> to edit, or <kbd class="font-mono text-viewer-sm">⇥</kbd> for the next item in review.
        </p>
      {/if}
    </div>
  {:else}
    <div class="flex-1 min-h-0 px-4 py-3.5 flex flex-col gap-2">
      <p class="font-serif text-2xl leading-none text-viewer-text-dim">Nothing selected</p>
      <p class="text-viewer-base text-viewer-text-dim">
        Click a block to inspect it, or press <kbd class="font-mono text-viewer-sm">⇥</kbd> for the next item in review.
      </p>
    </div>
  {/if}
</section>

<style>
  .ornament {
    color: var(--viewer-ornament);
  }

  /* 12px swatch: reuses the block recipe (tint, dashed + hatch when low confidence, ink cap when human). */
  .swatch {
    width: 12px;
    height: 12px;
    flex: none;
  }

  .conf-bar {
    position: relative;
    height: 8px;
    background: var(--viewer-surface-2);
    border: 1px solid var(--viewer-border);
  }

  .conf-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--h);
  }

  .conf-tick {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 1px;
    background: var(--viewer-text);
  }

  kbd {
    padding: 1px 4px;
    border: 1px solid var(--viewer-border);
    border-radius: 2px;
  }

  .btn {
    height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-radius: 2px;
    transition: background-color 150ms, border-color 150ms, color 150ms;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--viewer-accent);
    color: var(--viewer-accent-fg);
  }

  .btn-primary:not(:disabled):hover {
    background: var(--viewer-accent-hover);
  }

  .btn-outline {
    border: 1px solid var(--viewer-border);
    color: var(--viewer-text);
  }

  .btn-outline:not(:disabled):hover {
    border-color: var(--viewer-accent);
    background: var(--viewer-accent-bg);
  }

  .raw summary:focus-visible {
    outline: 2px solid var(--viewer-accent);
    outline-offset: 2px;
  }
</style>
