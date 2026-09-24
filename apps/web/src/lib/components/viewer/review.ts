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
 * undo/redo snapshots, the localStorage draft and reload carry it, and it
 * survives reindexing. EditorState.undo()/redo() mark the type dirty so the
 * restored array (with or without the stamp) is saved, and drop or restore
 * the step's pending audit edits, so an undone confirm never reaches
 * annotation_edits (one withdrawn while its save is in flight was already
 * sent; the next save still drops the stamp). Split, merge and resize re-stamp
 * the items they produce `confirmed: false` (a human changed the extent).
 *
 * `review.origin` is the item's review identity: the key of its original AI
 * form, set on the first stamp and carried by every later edit (see
 * AnnotationReview.origin). The queue ties an edited item back to its loaded
 * row through it (`reviewedBaselineKeys`, `locateQueueItem`).
 *
 * The server (`annotations.save`, server/trpc/annotation-save-rules.ts) owns
 * `by` / `at`: an unchanged item keeps the previous version's values, a new
 * stamp gets the caller and server time, and `supervisor_override` from an
 * annotator is refused unless that exact item was stored before (an undo).
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

/**
 * The `review.origin` a new stamp on an item edited from `pre` carries: the
 * pre-edit item's origin when it was already stamped (possibly none, for a
 * created item or a legacy stamp), else `pre`'s own key (its AI form).
 */
export function originFor(pre: ReviewableAnnotation): string | undefined {
  const review = getReview(pre);
  return review ? review.origin : reviewKey(pre);
}

export interface WithReviewOptions {
  confirmed: boolean;
  source?: AnnotationReview['source'];
  by?: string;
  at?: string;
  /**
   * The item as it was before this edit, for `review.origin` (see
   * AnnotationReview.origin). Defaults to `item` itself (a confirm). Pass the
   * original for a reclassify, resize or split, the lower item for a merge,
   * and `null` for an item a human created (no AI form, no origin).
   */
  from?: ReviewableAnnotation | null;
}

/** Return a copy of `item` stamped with human provenance. */
export function withReview<T extends ReviewableAnnotation>(item: T, opts: WithReviewOptions): T {
  const review: AnnotationReview = {
    source: opts.source ?? 'human',
    confirmed: opts.confirmed,
  };
  if (opts.by) review.by = opts.by;
  review.at = opts.at ?? new Date().toISOString();
  const from = opts.from === undefined ? item : opts.from;
  const origin = from ? originFor(from) : undefined;
  if (origin !== undefined) review.origin = origin;
  return { ...structuredClone(item), review } as T;
}

/**
 * Stamp the items an extent edit produced (split halves, a merge, a resize or
 * move) as human-decided, `confirmed: false`: a person changed them, so the old
 * stamp ("accepted unchanged", or one side of a merge) no longer describes
 * them. `from` is the pre-edit item (the unsplit original, the merge's lower
 * item, the item before the drag), so both split halves and the merged item
 * keep its `origin`. User labels carry no `review`, so pass only the other types.
 */
export function stampExtentEdit<T extends ReviewableAnnotation>(item: T, by: string | undefined, from: ReviewableAnnotation): T {
  return withReview(item, { confirmed: false, by, from });
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
  /**
   * Task locked ranges. Items overlapping one can't be confirmed or
   * reclassified, so the queue and the progress counters leave them out.
   */
  lockedRanges?: readonly TimeRange[];
}

/** Order: start time, then key (deterministic tiebreak), then index. */
export function compareReviewItems(a: ReviewItem, b: ReviewItem): number {
  if (a.start !== b.start) return a.start - b.start;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return a.index - b.index;
}

/**
 * Every low-confidence AI item (intents + transcription words) that no human
 * has reviewed, sorted by start time, filtered by kind. Items inside
 * `source.lockedRanges` are left out.
 */
export function buildReviewQueue(source: ReviewQueueSource, filter: ReviewFilter = 'all'): ReviewItem[] {
  const out: ReviewItem[] = [];
  const locked = source.lockedRanges ?? [];
  // Keys are unique by construction: an exact duplicate (same range and label) is listed once
  const seen = new Set<string>();

  if (filter !== 'words' && source.intents) {
    source.intents.forEach((it, index) => {
      if (!isLowConfidence(it) || overlapsAny(it.time_range, locked)) return;
      const key = `intent|${reviewKey(it)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        key,
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
      if (!isLowConfidence(w) || overlapsAny(w.time_range, locked)) return;
      const key = `word|${reviewKey(w)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        key,
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

/**
 * Keys of the `baseline` queue rows (the queue as loaded) whose item a human
 * has since decided on, so the queue can keep them listed with a ✓.
 *
 * A row is reviewed iff some current human-reviewed item of the same kind
 * carries `review.origin` equal to the row's item key (a reclassify, resize,
 * move, confirm or either split half of that item), or has exactly the row's
 * key. There is no positional or overlap guess, so an unrelated human item
 * that lands on the row's index or time never marks it.
 *
 * Rows that drop out of both this set and the open queue: a deleted item, and
 * the upper item of a merge (the merged item keeps the lower item's origin
 * only). They are no longer an item anyone can review, so they are neither
 * open nor ✓.
 *
 * Keys still in `open` (the current queue) are left out, so a key is never
 * both open and reviewed (exact duplicates in the data, or a human item
 * created with an open item's exact range and label).
 */
export function reviewedBaselineKeys(
  baseline: readonly ReviewItem[],
  current: { intents?: readonly IntentAnnotation[] | null; words?: readonly SpeechWord[] | null },
  open: readonly ReviewItem[] = [],
): Set<string> {
  const decided = new Set<string>();
  const collect = (prefix: string, items: readonly ReviewableAnnotation[] | null | undefined) => {
    if (!items) return;
    for (const it of items) {
      if (!isHumanReviewed(it)) continue;
      decided.add(`${prefix}|${reviewKey(it)}`);
      const origin = getReview(it)?.origin;
      if (origin !== undefined) decided.add(`${prefix}|${origin}`);
    }
  };
  collect('intent', current.intents);
  collect('word', current.words);

  const openKeys = new Set(open.map((q) => q.key));
  const keys = new Set<string>();
  for (const q of baseline) {
    if (decided.has(q.key) && !openKeys.has(q.key)) keys.add(q.key);
  }
  return keys;
}

/**
 * The open queue plus the reviewed baseline rows (`reviewedKeys`), sorted,
 * each key once. Unique by construction: open rows come first and a baseline
 * row is added only when its key isn't taken, so a keyed `{#each}` never sees
 * a duplicate.
 */
export function mergeQueueRows(
  open: readonly ReviewItem[],
  baseline: readonly ReviewItem[],
  reviewedKeys: ReadonlySet<string>,
): ReviewItem[] {
  const seen = new Set<string>();
  const rows: ReviewItem[] = [];
  for (const q of open) {
    if (seen.has(q.key)) continue;
    seen.add(q.key);
    rows.push(q);
  }
  for (const q of baseline) {
    if (!reviewedKeys.has(q.key) || seen.has(q.key)) continue;
    seen.add(q.key);
    rows.push(q);
  }
  return rows.sort(compareReviewItems);
}

/**
 * Index of a queue row's item in an editor array: the item with the row's
 * key (preferring an unreviewed one, and the row's build-time index when it
 * still fits), else the item whose `review.origin` is the row's (a reviewed
 * row whose item was reclassified, resized or split). -1 when it's gone.
 */
export function locateQueueItem(items: readonly ReviewableAnnotation[], q: ReviewItem): number {
  const itemKey = q.key.slice(q.kind.length + 1);
  const hint = items[q.index];
  if (hint && reviewKey(hint) === itemKey && !isHumanReviewed(hint)) return q.index;
  let reviewedMatch = -1;
  for (let i = 0; i < items.length; i++) {
    if (reviewKey(items[i]) !== itemKey) continue;
    if (!isHumanReviewed(items[i])) return i;
    if (reviewedMatch < 0) reviewedMatch = i;
  }
  if (reviewedMatch >= 0) return reviewedMatch;
  return items.findIndex((it) => getReview(it)?.origin === itemKey);
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

/** True when the scope covers at least one review kind (a verify-states task covers none). */
export function hasReviewScope(scope: ReviewScope): boolean {
  return scope.intents || scope.words;
}

/**
 * Review progress over the types in scope. Every intent is reviewable. Words
 * are reviewed by exception: only low-confidence or already-reviewed words
 * count, since nobody walks every word of a transcript. Items inside
 * `source.lockedRanges` don't count at all: nobody may act on them.
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
  const locked = source.lockedRanges ?? [];

  if (scope.intents && source.intents) {
    for (const it of source.intents) {
      if (overlapsAny(it.time_range, locked)) continue;
      intentsTotal++;
      if (isHumanReviewed(it)) intentsReviewed++;
      else if (isLowConfidence(it)) lowConfRemaining++;
    }
    totalReviewable += intentsTotal;
    reviewedCount += intentsReviewed;
  }

  if (scope.words && source.words) {
    for (const w of source.words) {
      if (overlapsAny(w.time_range, locked)) continue;
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
  /** Right-aligned mono meta: "31 / 46", "4 left", "2", "N/A" */
  meta: string;
  done: boolean;
  /** False when the row doesn't apply to this task (review rows on a task that reviews nothing); such a row is done */
  applicable: boolean;
}

function reviewedRowText(scope: ReviewScope): string {
  if (scope.intents && !scope.words) return 'Every intent reviewed';
  if (scope.words && !scope.intents) return 'Every flagged word reviewed';
  return 'Every item reviewed';
}

/**
 * The four "Before you submit" rows from the task panel design. With an
 * empty review scope (the task can edit neither intents nor words) the two
 * review rows read N/A and count as done.
 */
export function buildTaskChecklist(input: ChecklistInput): ChecklistItem[] {
  const reviewing = hasReviewScope(input.scope);
  const progress = computeReviewProgress({ ...input.current, lockedRanges: input.lockedRanges }, input.scope);
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
    reviewing
      ? {
          id: 'all-reviewed',
          text: reviewedRowText(input.scope),
          meta: `${reviewed} / ${total}`,
          done: reviewed >= total,
          applicable: true,
        }
      : { id: 'all-reviewed', text: 'Every item reviewed', meta: 'N/A', done: true, applicable: false },
    reviewing
      ? {
          id: 'low-confidence',
          text: 'Low-confidence resolved',
          meta: progress.lowConfRemaining > 0 ? `${progress.lowConfRemaining} left` : '',
          done: progress.lowConfRemaining === 0,
          applicable: true,
        }
      : { id: 'low-confidence', text: 'Low-confidence resolved', meta: 'N/A', done: true, applicable: false },
    {
      id: 'no-overlaps',
      text: 'No overlaps',
      meta: overlapCount > 0 ? String(overlapCount) : '',
      done: overlapCount === 0,
      applicable: true,
    },
    {
      id: 'locked-untouched',
      text: 'Locked ranges untouched',
      meta: input.lockedRanges.length > 0 ? String(input.lockedRanges.length) : '',
      done: untouched,
      applicable: true,
    },
  ];
}
