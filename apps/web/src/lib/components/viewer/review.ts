/**
 * Review model: low-confidence detection, per-item provenance, the review
 * queue (⇥ / ⇧⇥ / ↵) and the task-mode checklist.
 *
 * Pure functions only (no runes), so everything here is unit-tested in
 * review.test.ts and shared by the viewer, the queue, the overview and
 * TaskModeState.
 *
 * ## How provenance is represented
 *
 * `annotation_sets.source` is set-level: the first human save of a type makes
 * the whole set "human", even though most items in it are still untouched AI
 * predictions. So it can't tell which items a person decided on.
 *
 * Per-item provenance lives on the item itself, in the optional
 * `review?: AnnotationReview` field (`@annotation/shared`), which is stored in
 * the annotation_sets JSONB `data`:
 *   - absent                         → AI prediction (pipeline output)
 *   - `{ source, confirmed: true }`  → a human accepted it unchanged (EditType "confirm")
 *   - `{ source, confirmed: false }` → a human decided on it some other way (reclassify, create)
 *
 * Keeping the flag in the data (not in a side table or set metadata) means
 * undo/redo snapshots, the localStorage draft, autosave and reload all carry
 * it with no extra plumbing, and it survives reindexing (split/merge/create).
 *
 * Fallbacks when there is no `review` stamp (e.g. data saved before it existed):
 *   - backchannels and user labels have no pipeline stage → always "human".
 *   - states and words come from the pipeline → "ai".
 *   - intents created by the edit toolbar (`confidence: 1`, reasoning
 *     "Manually created") → "human"; every other intent → "ai".
 */

import type {
  AnnotationReview,
  AnnotationSource,
  BackchannelAnnotation,
  IntentAnnotation,
  SpeechWord,
  StateAnnotation,
  TimeRange,
  UserLabel,
} from '@annotation/shared';
import type { EditableType } from './state/editor.svelte.js';

/** Confidence below this is "low": dashed/hatched block, review queue, overview tick. */
export const LOW_CONFIDENCE = 0.6;

/** Reasoning string the edit toolbar writes on manually created intents (legacy provenance). */
export const MANUAL_INTENT_REASONING = 'Manually created';

/** Tolerance for time comparisons in navigation (seconds). */
const TIME_EPS = 1e-6;

export type Provenance = AnnotationSource;

export type ReviewableAnnotation =
  | StateAnnotation
  | IntentAnnotation
  | SpeechWord
  | BackchannelAnnotation
  | UserLabel;

// --- Item introspection ---

function isIntent(item: ReviewableAnnotation): item is IntentAnnotation {
  return 'intent_classification' in item;
}

function isWord(item: ReviewableAnnotation): item is SpeechWord {
  return 'speech' in item;
}

function isState(item: ReviewableAnnotation): item is StateAnnotation {
  return 'category' in item;
}

function isBackchannel(item: ReviewableAnnotation): item is BackchannelAnnotation {
  return 'backchannel' in item;
}

/** The model confidence carried by the item, or null when it has none (states, backchannels, labels). */
export function getConfidence(item: ReviewableAnnotation): number | null {
  if (isIntent(item)) return item.intent_classification.confidence;
  if (isWord(item)) return item.speech.confidence;
  return null;
}

/** Human-readable label used in keys and the queue (category, word, type or text). */
export function getItemLabel(item: ReviewableAnnotation): string {
  if (isIntent(item)) return item.intent_classification.intent;
  if (isWord(item)) return item.speech.word;
  if (isState(item)) return item.category;
  if (isBackchannel(item)) return item.backchannel.type;
  return (item as UserLabel).text;
}

function getReview(item: ReviewableAnnotation): AnnotationReview | undefined {
  return (item as { review?: AnnotationReview }).review;
}

/**
 * Stable identity for an item: `start|end|label`. Survives reindexing (an
 * insert before it shifts its index, not its key) and changes when the item's
 * time range or category changes. Used for roving focus, the queue selection
 * and the locked-range check.
 */
export function reviewKey(item: ReviewableAnnotation): string {
  return `${item.time_range.start}|${item.time_range.end}|${getItemLabel(item)}`;
}

/** Where the item came from. See the module comment for the rules. */
export function getProvenance(item: ReviewableAnnotation): Provenance {
  const review = getReview(item);
  if (review) return review.source;
  if (isIntent(item)) {
    const ic = item.intent_classification;
    if (ic.reasoning === MANUAL_INTENT_REASONING && ic.confidence >= 1) return 'human';
    return 'ai';
  }
  if (isWord(item) || isState(item)) return 'ai';
  // Backchannels and user labels have no pipeline stage: always human.
  return 'human';
}

/** True when a person has decided on the item (confirmed, reclassified or created it). */
export function isHumanReviewed(item: ReviewableAnnotation): boolean {
  return getProvenance(item) !== 'ai';
}

/** True when a person accepted the AI prediction unchanged. */
export function isConfirmed(item: ReviewableAnnotation): boolean {
  return getReview(item)?.confirmed === true;
}

/** Raw threshold check on a confidence value. */
export function isLowConfidenceValue(confidence: number | null | undefined): boolean {
  return confidence != null && confidence < LOW_CONFIDENCE;
}

/**
 * Low confidence = an AI prediction below LOW_CONFIDENCE that no human has
 * decided on yet. Drives `data-lowconf`, the queue and the overview ticks.
 */
export function isLowConfidence(item: ReviewableAnnotation): boolean {
  return isLowConfidenceValue(getConfidence(item)) && !isHumanReviewed(item);
}

/** Return a copy of `item` stamped with human provenance. */
export function withReview<T extends ReviewableAnnotation>(
  item: T,
  opts: { confirmed: boolean; source?: AnnotationReview['source']; by?: string; at?: string },
): T {
  const review: AnnotationReview = {
    source: opts.source ?? 'human',
    confirmed: opts.confirmed,
  };
  if (opts.by) review.by = opts.by;
  review.at = opts.at ?? new Date().toISOString();
  return { ...structuredClone(item), review } as T;
}

/** Copy of `item` without its `review` stamp (for content comparisons). */
function stripReview<T extends ReviewableAnnotation>(item: T): T {
  if (!getReview(item)) return item;
  const { review: _review, ...rest } = item as T & { review?: AnnotationReview };
  return rest as T;
}

// --- Review queue ---

export type ReviewKind = 'intent' | 'word';
export type ReviewFilter = 'all' | 'intents' | 'words';
/** How a queue row was activated: a pointer click moves focus back to the viewer so ⇥ / ↵ keep driving review */
export type ReviewSelectVia = 'pointer' | 'keyboard';

export interface ReviewItem {
  /** `${kind}|${reviewKey(item)}`: unique across kinds, stable across reindexing */
  key: string;
  kind: ReviewKind;
  /** EditorState array the item lives in */
  editableType: Extract<EditableType, 'intents' | 'transcription'>;
  /** Index into that array at build time (rebuild the queue after edits) */
  index: number;
  start: number;
  end: number;
  /** Intent category or the raw word (add quotes in the UI) */
  label: string;
  confidence: number;
  speaker: string | null;
}

export interface ReviewQueueSource {
  intents?: readonly IntentAnnotation[] | null;
  words?: readonly SpeechWord[] | null;
}

/** Order: start time, then key (deterministic tiebreak), then index. */
export function compareReviewItems(a: ReviewItem, b: ReviewItem): number {
  if (a.start !== b.start) return a.start - b.start;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return a.index - b.index;
}

/**
 * Every low-confidence AI item (intents + transcription words) that no human
 * has reviewed, sorted by start time, filtered by kind.
 */
export function buildReviewQueue(source: ReviewQueueSource, filter: ReviewFilter = 'all'): ReviewItem[] {
  const out: ReviewItem[] = [];

  if (filter !== 'words' && source.intents) {
    source.intents.forEach((it, index) => {
      if (!isLowConfidence(it)) return;
      out.push({
        key: `intent|${reviewKey(it)}`,
        kind: 'intent',
        editableType: 'intents',
        index,
        start: it.time_range.start,
        end: it.time_range.end,
        label: it.intent_classification.intent,
        confidence: it.intent_classification.confidence,
        speaker: null,
      });
    });
  }

  if (filter !== 'intents' && source.words) {
    source.words.forEach((w, index) => {
      if (!isLowConfidence(w)) return;
      out.push({
        key: `word|${reviewKey(w)}`,
        kind: 'word',
        editableType: 'transcription',
        index,
        start: w.time_range.start,
        end: w.time_range.end,
        label: w.speech.word,
        confidence: w.speech.confidence,
        speaker: w.speech.speaker,
      });
    });
  }

  return out.sort(compareReviewItems);
}

/** Narrow an already-built "all" queue to one kind (cheaper than rebuilding). */
export function filterReviewQueue(queue: readonly ReviewItem[], filter: ReviewFilter): ReviewItem[] {
  if (filter === 'all') return [...queue];
  const kind: ReviewKind = filter === 'intents' ? 'intent' : 'word';
  return queue.filter((q) => q.kind === kind);
}

/** Tab counts for the All | Intents | Words filter. */
export function countReviewQueue(queue: readonly ReviewItem[]): Record<ReviewFilter, number> {
  let intents = 0;
  let words = 0;
  for (const q of queue) {
    if (q.kind === 'intent') intents++;
    else words++;
  }
  return { all: queue.length, intents, words };
}

/** Queue key for an item in an editor array (matches ReviewItem.key). */
export function queueKeyFor(
  editableType: EditableType,
  item: ReviewableAnnotation,
): string | null {
  if (editableType === 'intents') return `intent|${reviewKey(item)}`;
  if (editableType === 'transcription') return `word|${reviewKey(item)}`;
  return null;
}

export interface ReviewAnchor {
  /** Playhead, or the selected item's start time */
  time: number;
  /** Queue key of the selected item, if any (see queueKeyFor) */
  key?: string | null;
}

export interface ReviewNavOptions {
  /** Wrap from the last item to the first (and back). Default true. */
  wrap?: boolean;
}

/** Position of the anchor relative to an item: <0 item is before, >0 item is after. */
function compareToAnchor(item: ReviewItem, anchor: ReviewAnchor): number {
  if (Math.abs(item.start - anchor.time) > TIME_EPS) return item.start - anchor.time;
  const key = anchor.key ?? '';
  if (item.key === key) return 0;
  return item.key < key ? -1 : 1;
}

/**
 * Next queue item after the selection (if it is in the queue) or after the
 * anchor time. With no selection, an item starting exactly at the playhead
 * counts as "next". A selected item that has just been confirmed has left the
 * queue; pass its start time and key and the neighbour is still found.
 */
export function nextReviewItem(
  queue: readonly ReviewItem[],
  anchor: ReviewAnchor,
  opts: ReviewNavOptions = {},
): ReviewItem | null {
  if (queue.length === 0) return null;
  const wrap = opts.wrap ?? true;

  const selected = anchor.key ? queue.findIndex((q) => q.key === anchor.key) : -1;
  let idx: number;
  if (selected >= 0) {
    idx = selected + 1;
  } else {
    idx = queue.findIndex((q) => compareToAnchor(q, anchor) > 0);
    if (idx < 0) idx = queue.length;
  }

  if (idx < queue.length) return queue[idx];
  if (!wrap) return null;
  const first = queue[0];
  return selected === 0 ? null : first;
}

/** Previous queue item before the selection or the anchor time. Mirrors nextReviewItem. */
export function prevReviewItem(
  queue: readonly ReviewItem[],
  anchor: ReviewAnchor,
  opts: ReviewNavOptions = {},
): ReviewItem | null {
  if (queue.length === 0) return null;
  const wrap = opts.wrap ?? true;

  const selected = anchor.key ? queue.findIndex((q) => q.key === anchor.key) : -1;
  let idx: number;
  if (selected >= 0) {
    idx = selected - 1;
  } else {
    idx = -1;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (compareToAnchor(queue[i], anchor) < 0) {
        idx = i;
        break;
      }
    }
  }

  if (idx >= 0) return queue[idx];
  if (!wrap) return null;
  const last = queue[queue.length - 1];
  return selected === queue.length - 1 ? null : last;
}

// --- Progress + checklist (task mode) ---

export interface ReviewProgress {
  /** Items a human has decided on, within scope */
  reviewedCount: number;
  /** All intents in scope, plus words that are low-confidence or already reviewed */
  totalReviewable: number;
  /** Queue length within scope */
  lowConfRemaining: number;
  /** Intent-only split for the "Every intent reviewed" row */
  intentsReviewed: number;
  intentsTotal: number;
}

export interface ReviewScope {
  intents: boolean;
  words: boolean;
}

/**
 * Review progress over the types in scope. Every intent is reviewable. Words
 * are reviewed by exception: only low-confidence or already-reviewed words
 * count, since nobody walks every word of a transcript.
 */
export function computeReviewProgress(
  source: ReviewQueueSource,
  scope: ReviewScope = { intents: true, words: true },
): ReviewProgress {
  let reviewedCount = 0;
  let totalReviewable = 0;
  let lowConfRemaining = 0;
  let intentsReviewed = 0;
  let intentsTotal = 0;

  if (scope.intents && source.intents) {
    for (const it of source.intents) {
      intentsTotal++;
      if (isHumanReviewed(it)) intentsReviewed++;
      else if (isLowConfidence(it)) lowConfRemaining++;
    }
    totalReviewable += intentsTotal;
    reviewedCount += intentsReviewed;
  }

  if (scope.words && source.words) {
    for (const w of source.words) {
      if (isHumanReviewed(w)) {
        reviewedCount++;
        totalReviewable++;
      } else if (isLowConfidence(w)) {
        lowConfRemaining++;
        totalReviewable++;
      }
    }
  }

  return { reviewedCount, totalReviewable, lowConfRemaining, intentsReviewed, intentsTotal };
}

/** Index pairs [i, j] (i < j) of items whose half-open ranges overlap. Input order doesn't matter. */
export function findOverlaps(items: readonly { time_range: TimeRange }[]): [number, number][] {
  const order = items.map((_, i) => i).sort((a, b) => items[a].time_range.start - items[b].time_range.start);
  const pairs: [number, number][] = [];
  for (let a = 0; a < order.length; a++) {
    const ra = items[order[a]].time_range;
    for (let b = a + 1; b < order.length; b++) {
      const rb = items[order[b]].time_range;
      if (rb.start >= ra.end) break;
      const i = Math.min(order[a], order[b]);
      const j = Math.max(order[a], order[b]);
      pairs.push([i, j]);
    }
  }
  return pairs;
}

function overlapsAny(range: TimeRange, ranges: readonly TimeRange[]): boolean {
  return ranges.some((l) => range.start < l.end && range.end > l.start);
}

/** Content signature of the items touching locked ranges (review stamps ignored). */
function lockedSignature(items: readonly ReviewableAnnotation[], locked: readonly TimeRange[]): string[] {
  return items
    .filter((it) => overlapsAny(it.time_range, locked))
    .map((it) => JSON.stringify(stripReview(it)))
    .sort();
}

/**
 * True when no item touching a locked range was added, removed or changed
 * between `baseline` and `current`. A confirm stamp alone isn't a change.
 */
export function lockedRangesUntouched(
  baseline: readonly ReviewableAnnotation[] | null | undefined,
  current: readonly ReviewableAnnotation[] | null | undefined,
  locked: readonly TimeRange[],
): boolean {
  if (locked.length === 0) return true;
  const a = lockedSignature(baseline ?? [], locked);
  const b = lockedSignature(current ?? [], locked);
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

export interface ChecklistTracks {
  intents?: readonly IntentAnnotation[] | null;
  words?: readonly SpeechWord[] | null;
  states?: readonly StateAnnotation[] | null;
  backchannels?: readonly BackchannelAnnotation[] | null;
}

export interface ChecklistInput {
  /** Current (editor) data */
  current: ChecklistTracks;
  /** Data as loaded, before this session's edits (for the locked-range check) */
  baseline?: ChecklistTracks;
  /** Which review kinds the task covers */
  scope: ReviewScope;
  /** Which tracks the overlap check covers (usually the task's editable types) */
  overlapTracks: (keyof ChecklistTracks)[];
  lockedRanges: readonly TimeRange[];
}

export type ChecklistId = 'all-reviewed' | 'low-confidence' | 'no-overlaps' | 'locked-untouched';

export interface ChecklistItem {
  id: ChecklistId;
  text: string;
  /** Right-aligned mono meta: "31 / 46", "4 left", "2" */
  meta: string;
  done: boolean;
}

function reviewedRowText(scope: ReviewScope): string {
  if (scope.intents && !scope.words) return 'Every intent reviewed';
  if (scope.words && !scope.intents) return 'Every flagged word reviewed';
  return 'Every item reviewed';
}

/** The four "Before you submit" rows from the task panel design. */
export function buildTaskChecklist(input: ChecklistInput): ChecklistItem[] {
  const progress = computeReviewProgress(input.current, input.scope);
  const onlyIntents = input.scope.intents && !input.scope.words;
  const reviewed = onlyIntents ? progress.intentsReviewed : progress.reviewedCount;
  const total = onlyIntents ? progress.intentsTotal : progress.totalReviewable;

  let overlapCount = 0;
  for (const track of input.overlapTracks) {
    const items = input.current[track];
    if (items) overlapCount += findOverlaps(items).length;
  }

  const trackKeys: (keyof ChecklistTracks)[] = ['intents', 'words', 'states', 'backchannels'];
  const untouched = !input.baseline
    ? true
    : trackKeys.every((k) =>
        lockedRangesUntouched(
          input.baseline![k] as ReviewableAnnotation[] | null | undefined,
          input.current[k] as ReviewableAnnotation[] | null | undefined,
          input.lockedRanges,
        ),
      );

  return [
    {
      id: 'all-reviewed',
      text: reviewedRowText(input.scope),
      meta: `${reviewed} / ${total}`,
      done: reviewed >= total,
    },
    {
      id: 'low-confidence',
      text: 'Low-confidence resolved',
      meta: progress.lowConfRemaining > 0 ? `${progress.lowConfRemaining} left` : '',
      done: progress.lowConfRemaining === 0,
    },
    {
      id: 'no-overlaps',
      text: 'No overlaps',
      meta: overlapCount > 0 ? String(overlapCount) : '',
      done: overlapCount === 0,
    },
    {
      id: 'locked-untouched',
      text: 'Locked ranges untouched',
      meta: input.lockedRanges.length > 0 ? String(input.lockedRanges.length) : '',
      done: untouched,
    },
  ];
}
