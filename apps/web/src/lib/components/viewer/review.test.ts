import { describe, it, expect } from 'vitest';
import type {
	IntentAnnotation,
	SpeechWord,
	StateAnnotation,
	BackchannelAnnotation,
	UserLabel,
	IntentType,
} from '@annotation/shared';
import {
	LOW_CONFIDENCE,
	MANUAL_INTENT_REASONING,
	getConfidence,
	getItemLabel,
	reviewKey,
	getProvenance,
	isHumanReviewed,
	isConfirmed,
	isLowConfidence,
	isLowConfidenceValue,
	withReview,
	buildReviewQueue,
	filterReviewQueue,
	countReviewQueue,
	queueKeyFor,
	nextReviewItem,
	prevReviewItem,
	computeReviewProgress,
	findOverlaps,
	lockedRangesUntouched,
	buildTaskChecklist,
	reviewedBaselineKeys,
	mergeQueueRows,
	locateQueueItem,
	originFor,
	stampExtentEdit,
	hasReviewScope,
	type ReviewItem,
} from './review';

const mkIntent = (start: number, end: number, confidence = 0.9, intent: IntentType = 'inform'): IntentAnnotation => ({
	time_range: { start, end },
	intent_classification: { intent, intensity: 'moderate', valence: 'neutral', confidence, reasoning: 'model' },
});

const mkWord = (start: number, end: number, word: string, confidence = 0.95, speaker = 'S0'): SpeechWord => ({
	time_range: { start, end },
	speech: { word, speaker, confidence, speech_segment: 0 },
});

const mkState = (start: number, end: number): StateAnnotation => ({
	time_range: { start, end },
	category: 'expression.state.speaking',
	note: '',
	parameters: {},
});

const mkBackchannel = (start: number, end: number): BackchannelAnnotation => ({
	time_range: { start, end },
	backchannel: { type: 'agreement', speaker: 'S1', note: '' },
});

const mkLabel = (start: number, end: number, text = 'note'): UserLabel => ({ time_range: { start, end }, text });

const confirmed = <T extends IntentAnnotation | SpeechWord | StateAnnotation>(item: T): T =>
	withReview(item, { confirmed: true, at: '2026-01-01T00:00:00Z' });

describe('LOW_CONFIDENCE', () => {
	it('is 0.6', () => {
		expect(LOW_CONFIDENCE).toBe(0.6);
	});
});

describe('item introspection', () => {
	it('reads confidence from intents and words, null otherwise', () => {
		expect(getConfidence(mkIntent(0, 1, 0.42))).toBe(0.42);
		expect(getConfidence(mkWord(0, 1, 'hi', 0.3))).toBe(0.3);
		expect(getConfidence(mkState(0, 1))).toBeNull();
		expect(getConfidence(mkBackchannel(0, 1))).toBeNull();
		expect(getConfidence(mkLabel(0, 1))).toBeNull();
	});

	it('labels each type', () => {
		expect(getItemLabel(mkIntent(0, 1, 0.9, 'challenge'))).toBe('challenge');
		expect(getItemLabel(mkWord(0, 1, 'hello'))).toBe('hello');
		expect(getItemLabel(mkState(0, 1))).toBe('expression.state.speaking');
		expect(getItemLabel(mkBackchannel(0, 1))).toBe('agreement');
		expect(getItemLabel(mkLabel(0, 1, 'laugh'))).toBe('laugh');
	});

	it('builds start|end|label keys that ignore array position and review stamps', () => {
		const it1 = mkIntent(1.5, 2.25, 0.4, 'inquire');
		expect(reviewKey(it1)).toBe('1.5|2.25|inquire');
		expect(reviewKey(confirmed(it1))).toBe(reviewKey(it1));
		expect(reviewKey(mkIntent(1.5, 2.25, 0.4, 'inform'))).not.toBe(reviewKey(it1));
		expect(reviewKey(mkIntent(1.5, 2.5, 0.4, 'inquire'))).not.toBe(reviewKey(it1));
	});
});

describe('provenance', () => {
	it('treats unstamped pipeline items as ai', () => {
		expect(getProvenance(mkIntent(0, 1))).toBe('ai');
		expect(getProvenance(mkWord(0, 1, 'a'))).toBe('ai');
		expect(getProvenance(mkState(0, 1))).toBe('ai');
	});

	it('treats human-only types as human', () => {
		expect(getProvenance(mkBackchannel(0, 1))).toBe('human');
		expect(getProvenance(mkLabel(0, 1))).toBe('human');
	});

	it('reads the review stamp', () => {
		expect(getProvenance(confirmed(mkIntent(0, 1)))).toBe('human');
		const sup = withReview(mkIntent(0, 1), { confirmed: false, source: 'supervisor_override' });
		expect(getProvenance(sup)).toBe('supervisor_override');
	});

	it('recognises legacy manually created intents', () => {
		const manual = mkIntent(0, 1, 1);
		manual.intent_classification.reasoning = MANUAL_INTENT_REASONING;
		expect(getProvenance(manual)).toBe('human');
		// Same reasoning but a model-looking confidence stays ai
		const odd = mkIntent(0, 1, 0.5);
		odd.intent_classification.reasoning = MANUAL_INTENT_REASONING;
		expect(getProvenance(odd)).toBe('ai');
	});

	it('distinguishes confirmed from other human decisions', () => {
		const c = confirmed(mkIntent(0, 1));
		const r = withReview(mkIntent(0, 1), { confirmed: false });
		expect(isConfirmed(c)).toBe(true);
		expect(isConfirmed(r)).toBe(false);
		expect(isHumanReviewed(c)).toBe(true);
		expect(isHumanReviewed(r)).toBe(true);
		expect(isHumanReviewed(mkIntent(0, 1))).toBe(false);
	});

	it('withReview copies instead of mutating and fills defaults', () => {
		const orig = mkIntent(0, 1);
		const stamped = withReview(orig, { confirmed: true, by: 'u1' });
		expect(orig.review).toBeUndefined();
		expect(stamped.review).toMatchObject({ source: 'human', confirmed: true, by: 'u1' });
		expect(Number.isNaN(Date.parse(stamped.review!.at!))).toBe(false);
		stamped.intent_classification.intent = 'engage';
		expect(orig.intent_classification.intent).toBe('inform');
	});

	it('omits `by` when not given', () => {
		expect(withReview(mkIntent(0, 1), { confirmed: true }).review).not.toHaveProperty('by');
	});
});

describe('isLowConfidence', () => {
	it('uses a strict < threshold', () => {
		expect(isLowConfidenceValue(0.59)).toBe(true);
		expect(isLowConfidenceValue(0.6)).toBe(false);
		expect(isLowConfidenceValue(null)).toBe(false);
		expect(isLowConfidenceValue(undefined)).toBe(false);
	});

	it('flags only unreviewed ai items below the threshold', () => {
		expect(isLowConfidence(mkIntent(0, 1, 0.48))).toBe(true);
		expect(isLowConfidence(mkIntent(0, 1, 0.6))).toBe(false);
		expect(isLowConfidence(mkWord(0, 1, 'x', 0.2))).toBe(true);
		expect(isLowConfidence(confirmed(mkIntent(0, 1, 0.48)))).toBe(false);
		expect(isLowConfidence(confirmed(mkWord(0, 1, 'x', 0.2)))).toBe(false);
		expect(isLowConfidence(mkState(0, 1))).toBe(false);
		expect(isLowConfidence(mkLabel(0, 1))).toBe(false);
	});
});

describe('buildReviewQueue', () => {
	const intents = [
		mkIntent(10, 12, 0.9),
		mkIntent(20, 22, 0.4, 'inquire'),
		confirmed(mkIntent(30, 32, 0.3)),
		mkIntent(5, 6, 0.55, 'challenge'),
	];
	const words = [mkWord(4, 4.5, 'um', 0.3), mkWord(21, 21.5, 'yes', 0.99), mkWord(25, 25.3, 'er', 0.1, 'S1')];

	it('includes low-confidence unreviewed intents and words, sorted by start', () => {
		const q = buildReviewQueue({ intents, words });
		expect(q.map((x) => [x.kind, x.start])).toEqual([
			['word', 4],
			['intent', 5],
			['intent', 20],
			['word', 25],
		]);
	});

	it('carries indices, labels, confidence and speaker', () => {
		const q = buildReviewQueue({ intents, words });
		const intent = q.find((x) => x.start === 20)!;
		expect(intent).toMatchObject({
			kind: 'intent',
			editableType: 'intents',
			index: 1,
			end: 22,
			label: 'inquire',
			confidence: 0.4,
			speaker: null,
			key: 'intent|20|22|inquire',
		});
		const word = q.find((x) => x.start === 25)!;
		expect(word).toMatchObject({ kind: 'word', editableType: 'transcription', index: 2, label: 'er', speaker: 'S1' });
	});

	it('filters by kind', () => {
		expect(buildReviewQueue({ intents, words }, 'intents').every((x) => x.kind === 'intent')).toBe(true);
		expect(buildReviewQueue({ intents, words }, 'intents')).toHaveLength(2);
		expect(buildReviewQueue({ intents, words }, 'words')).toHaveLength(2);
	});

	it('leaves out items inside locked ranges', () => {
		const q = buildReviewQueue({ intents, words, lockedRanges: [{ start: 19, end: 26 }] });
		expect(q.map((x) => [x.kind, x.start])).toEqual([
			['word', 4],
			['intent', 5],
		]);
		// Half-open: a range ending where an item starts doesn't lock it
		expect(buildReviewQueue({ intents, words, lockedRanges: [{ start: 3, end: 4 }] })).toHaveLength(4);
	});

	it('handles missing sources', () => {
		expect(buildReviewQueue({})).toEqual([]);
		expect(buildReviewQueue({ intents: null, words })).toHaveLength(2);
	});

	it('breaks start-time ties deterministically', () => {
		const q1 = buildReviewQueue({ intents: [mkIntent(3, 4, 0.1, 'inform')], words: [mkWord(3, 3.2, 'a', 0.1)] });
		const q2 = buildReviewQueue({ words: [mkWord(3, 3.2, 'a', 0.1)], intents: [mkIntent(3, 4, 0.1, 'inform')] });
		expect(q1.map((x) => x.key)).toEqual(q2.map((x) => x.key));
	});

	it('filterReviewQueue and countReviewQueue agree with rebuilding', () => {
		const all = buildReviewQueue({ intents, words });
		expect(filterReviewQueue(all, 'intents')).toEqual(buildReviewQueue({ intents, words }, 'intents'));
		expect(filterReviewQueue(all, 'words')).toEqual(buildReviewQueue({ intents, words }, 'words'));
		expect(filterReviewQueue(all, 'all')).toEqual(all);
		expect(filterReviewQueue(all, 'all')).not.toBe(all);
		expect(countReviewQueue(all)).toEqual({ all: 4, intents: 2, words: 2 });
	});

	it('queueKeyFor matches queue keys for editor items', () => {
		const q = buildReviewQueue({ intents, words });
		expect(queueKeyFor('intents', intents[1])).toBe(q.find((x) => x.start === 20)!.key);
		expect(queueKeyFor('transcription', words[0])).toBe(q[0].key);
		expect(queueKeyFor('states', mkState(0, 1))).toBeNull();
	});
});

describe('review navigation', () => {
	const mk = (start: number, key: string): ReviewItem => ({
		key,
		kind: 'intent',
		editableType: 'intents',
		index: 0,
		start,
		end: start + 1,
		label: 'x',
		confidence: 0.1,
		speaker: null,
	});
	const queue = [mk(1, 'a'), mk(5, 'b'), mk(5, 'c'), mk(9, 'd')];

	it('returns null on an empty queue', () => {
		expect(nextReviewItem([], { time: 0 })).toBeNull();
		expect(prevReviewItem([], { time: 0 })).toBeNull();
	});

	it('steps from the selected item', () => {
		expect(nextReviewItem(queue, { time: 5, key: 'b' })!.key).toBe('c');
		expect(nextReviewItem(queue, { time: 5, key: 'c' })!.key).toBe('d');
		expect(prevReviewItem(queue, { time: 5, key: 'c' })!.key).toBe('b');
		expect(prevReviewItem(queue, { time: 5, key: 'b' })!.key).toBe('a');
	});

	it('steps from the playhead when nothing is selected', () => {
		expect(nextReviewItem(queue, { time: 0 })!.key).toBe('a');
		expect(nextReviewItem(queue, { time: 3 })!.key).toBe('b');
		expect(prevReviewItem(queue, { time: 7 })!.key).toBe('c');
		expect(prevReviewItem(queue, { time: 1.5 })!.key).toBe('a');
	});

	it('counts an item starting exactly at the playhead as next, not previous', () => {
		expect(nextReviewItem(queue, { time: 5 })!.key).toBe('b');
		expect(prevReviewItem(queue, { time: 5 })!.key).toBe('a');
	});

	it('finds neighbours of a selection that has left the queue (just confirmed)', () => {
		// 'b2' sorts between 'b' and 'c' at t=5 but is no longer queued
		expect(nextReviewItem(queue, { time: 5, key: 'b2' })!.key).toBe('c');
		expect(prevReviewItem(queue, { time: 5, key: 'b2' })!.key).toBe('b');
	});

	it('wraps by default and stops when wrap is false', () => {
		expect(nextReviewItem(queue, { time: 9, key: 'd' })!.key).toBe('a');
		expect(prevReviewItem(queue, { time: 1, key: 'a' })!.key).toBe('d');
		expect(nextReviewItem(queue, { time: 100 })!.key).toBe('a');
		expect(prevReviewItem(queue, { time: 0 })!.key).toBe('d');
		expect(nextReviewItem(queue, { time: 9, key: 'd' }, { wrap: false })).toBeNull();
		expect(prevReviewItem(queue, { time: 1, key: 'a' }, { wrap: false })).toBeNull();
	});

	it('returns null when the only item is already selected', () => {
		const one = [mk(2, 'solo')];
		expect(nextReviewItem(one, { time: 2, key: 'solo' })).toBeNull();
		expect(prevReviewItem(one, { time: 2, key: 'solo' })).toBeNull();
		expect(nextReviewItem(one, { time: 3 })!.key).toBe('solo');
	});
});

describe('computeReviewProgress', () => {
	const intents = [mkIntent(0, 1, 0.9), mkIntent(1, 2, 0.4), confirmed(mkIntent(2, 3, 0.3)), confirmed(mkIntent(3, 4, 0.8))];
	const words = [mkWord(0, 0.5, 'a', 0.99), mkWord(1, 1.5, 'b', 0.2), confirmed(mkWord(2, 2.5, 'c', 0.1))];

	it('counts all intents and flagged/reviewed words', () => {
		expect(computeReviewProgress({ intents, words })).toEqual({
			reviewedCount: 3,
			totalReviewable: 6,
			lowConfRemaining: 2,
			intentsReviewed: 2,
			intentsTotal: 4,
		});
	});

	it('respects scope', () => {
		expect(computeReviewProgress({ intents, words }, { intents: true, words: false })).toMatchObject({
			reviewedCount: 2,
			totalReviewable: 4,
			lowConfRemaining: 1,
		});
		expect(computeReviewProgress({ intents, words }, { intents: false, words: true })).toMatchObject({
			reviewedCount: 1,
			totalReviewable: 2,
			lowConfRemaining: 1,
			intentsTotal: 0,
		});
	});

	it('lowConfRemaining matches the queue length', () => {
		expect(computeReviewProgress({ intents, words }).lowConfRemaining).toBe(buildReviewQueue({ intents, words }).length);
	});

	it('skips items overlapping locked ranges', () => {
		const lockedRanges = [{ start: 1, end: 2 }];
		// Intent 1–2 (0.4) and word 1–1.5 (0.2) are locked
		expect(computeReviewProgress({ intents, words, lockedRanges })).toEqual({
			reviewedCount: 3,
			totalReviewable: 4,
			lowConfRemaining: 0,
			intentsReviewed: 2,
			intentsTotal: 3,
		});
		expect(computeReviewProgress({ intents, words, lockedRanges }).lowConfRemaining).toBe(
			buildReviewQueue({ intents, words, lockedRanges }).length,
		);
	});

	it('hasReviewScope is false only for an empty scope', () => {
		expect(hasReviewScope({ intents: false, words: false })).toBe(false);
		expect(hasReviewScope({ intents: true, words: false })).toBe(true);
		expect(hasReviewScope({ intents: false, words: true })).toBe(true);
	});
});

describe('findOverlaps', () => {
	it('returns no pairs for adjacent half-open ranges', () => {
		expect(findOverlaps([mkState(0, 5), mkState(5, 10)])).toEqual([]);
	});

	it('finds overlapping pairs regardless of order', () => {
		expect(findOverlaps([mkState(4, 6), mkState(0, 5), mkState(10, 11)])).toEqual([[0, 1]]);
		expect(findOverlaps([mkState(0, 10), mkState(1, 2), mkState(3, 4)])).toEqual([
			[0, 1],
			[0, 2],
		]);
	});

	it('handles empty input', () => {
		expect(findOverlaps([])).toEqual([]);
	});
});

describe('lockedRangesUntouched', () => {
	const locked = [{ start: 0, end: 2 }];
	const base = [mkIntent(0, 1), mkIntent(5, 6)];

	it('is true with no locked ranges or identical data', () => {
		expect(lockedRangesUntouched(base, [mkIntent(9, 10)], [])).toBe(true);
		expect(lockedRangesUntouched(base, structuredClone(base), locked)).toBe(true);
	});

	it('ignores edits outside locked ranges and confirm stamps', () => {
		expect(lockedRangesUntouched(base, [base[0], mkIntent(5, 7)], locked)).toBe(true);
		expect(lockedRangesUntouched(base, [confirmed(base[0]), base[1]], locked)).toBe(true);
	});

	it('detects resize, reclassify, delete and create inside locked ranges', () => {
		expect(lockedRangesUntouched(base, [mkIntent(0, 1.5), base[1]], locked)).toBe(false);
		expect(lockedRangesUntouched(base, [mkIntent(0, 1, 0.9, 'engage'), base[1]], locked)).toBe(false);
		expect(lockedRangesUntouched(base, [base[1]], locked)).toBe(false);
		expect(lockedRangesUntouched(base, [mkIntent(1.5, 1.8), ...base], locked)).toBe(false);
	});

	it('treats null as empty', () => {
		expect(lockedRangesUntouched(null, null, locked)).toBe(true);
		expect(lockedRangesUntouched(null, base, locked)).toBe(false);
	});
});

describe('buildTaskChecklist', () => {
	const locked = [
		{ start: 42, end: 44.8 },
		{ start: 64.2, end: 66 },
	];
	const intents = [mkIntent(40, 41, 0.9), mkIntent(45, 46, 0.4), confirmed(mkIntent(50, 51, 0.3))];

	it('produces the four design rows with meta', () => {
		const list = buildTaskChecklist({
			current: { intents },
			baseline: { intents },
			scope: { intents: true, words: false },
			overlapTracks: ['intents'],
			lockedRanges: locked,
		});
		expect(list.map((r) => r.id)).toEqual(['all-reviewed', 'low-confidence', 'no-overlaps', 'locked-untouched']);
		expect(list[0]).toEqual({ id: 'all-reviewed', text: 'Every intent reviewed', meta: '1 / 3', done: false, applicable: true });
		expect(list[1]).toEqual({ id: 'low-confidence', text: 'Low-confidence resolved', meta: '1 left', done: false, applicable: true });
		expect(list[2]).toEqual({ id: 'no-overlaps', text: 'No overlaps', meta: '', done: true, applicable: true });
		expect(list[3]).toEqual({ id: 'locked-untouched', text: 'Locked ranges untouched', meta: '2', done: true, applicable: true });
	});

	it('leaves items inside locked ranges out of the review rows', () => {
		// 43–44 sits in the locked 42–44.8 range: it can't be confirmed, so it doesn't count
		const withLocked = [...intents, mkIntent(43, 44, 0.3)];
		const list = buildTaskChecklist({
			current: { intents: withLocked },
			baseline: { intents: withLocked },
			scope: { intents: true, words: false },
			overlapTracks: ['intents'],
			lockedRanges: locked,
		});
		expect(list[0].meta).toBe('1 / 3');
		expect(list[1].meta).toBe('1 left');
	});

	it('marks the review rows N/A with no review scope', () => {
		const list = buildTaskChecklist({
			current: { intents },
			scope: { intents: false, words: false },
			overlapTracks: ['states'],
			lockedRanges: [],
		});
		expect(list[0]).toMatchObject({ meta: 'N/A', done: true, applicable: false });
		expect(list[1]).toMatchObject({ meta: 'N/A', done: true, applicable: false });
		expect(list.every((r) => r.done)).toBe(true);
	});

	it('marks rows done when everything is resolved', () => {
		const all = intents.map((i) => (isHumanReviewed(i) ? i : confirmed(i)));
		const list = buildTaskChecklist({
			current: { intents: all },
			scope: { intents: true, words: false },
			overlapTracks: ['intents'],
			lockedRanges: [],
		});
		expect(list.every((r) => r.done)).toBe(true);
		expect(list[0].meta).toBe('3 / 3');
		expect(list[1].meta).toBe('');
		expect(list[3].meta).toBe('');
	});

	it('flags overlaps and locked-range edits', () => {
		const current = [mkIntent(40, 41.5), mkIntent(41, 43), ...intents.slice(1)];
		const list = buildTaskChecklist({
			current: { intents: current },
			baseline: { intents },
			scope: { intents: true, words: false },
			overlapTracks: ['intents'],
			lockedRanges: locked,
		});
		expect(list[2]).toMatchObject({ done: false, meta: '1' });
		expect(list[3]).toMatchObject({ done: false });
	});

	it('uses combined counts and wording when words are in scope', () => {
		const list = buildTaskChecklist({
			current: { intents, words: [mkWord(1, 1.2, 'um', 0.2)] },
			scope: { intents: true, words: true },
			overlapTracks: [],
			lockedRanges: [],
		});
		expect(list[0]).toMatchObject({ text: 'Every item reviewed', meta: '1 / 4' });
		expect(list[1].meta).toBe('2 left');
	});

	it('treats an empty scope as done', () => {
		const list = buildTaskChecklist({ current: {}, scope: { intents: true, words: false }, overlapTracks: ['intents'], lockedRanges: [] });
		expect(list[0]).toMatchObject({ meta: '0 / 0', done: true });
	});
});

describe('stampExtentEdit', () => {
	it('re-stamps a confirmed item as human-decided, not confirmed', () => {
		const item = confirmed(mkIntent(0, 2, 0.4));
		const out = stampExtentEdit({ ...item, time_range: { start: 0, end: 1 } }, 'u1', item);
		expect(out.review).toMatchObject({ source: 'human', confirmed: false, by: 'u1', origin: '0|2|inform' });
		expect(isConfirmed(out)).toBe(false);
		expect(isHumanReviewed(out)).toBe(true);
		expect(item.review?.confirmed).toBe(true);
	});

	it('stamps an AI item, taking it out of the low-confidence set', () => {
		const word = mkWord(0, 1, 'um', 0.2);
		const out = stampExtentEdit({ ...word, time_range: { start: 0, end: 1.2 } }, undefined, word);
		expect(isLowConfidence(out)).toBe(false);
		expect(out.review?.confirmed).toBe(false);
		expect(out.review?.origin).toBe('0|1|um');
	});
});

describe('review origin', () => {
	const ai = mkIntent(10, 12, 0.4, 'inquire');

	it('is the AI form key on the first stamp (confirm)', () => {
		expect(withReview(ai, { confirmed: true }).review?.origin).toBe('10|12|inquire');
		expect(originFor(ai)).toBe('10|12|inquire');
	});

	it('comes from the pre-edit item on a reclassify, and is carried by later edits', () => {
		const reclassified = withReview(
			{ ...ai, intent_classification: { ...ai.intent_classification, intent: 'comfort' as const } },
			{ confirmed: false, from: ai },
		);
		expect(reclassified.review?.origin).toBe('10|12|inquire');
		const resized = stampExtentEdit({ ...reclassified, time_range: { start: 9, end: 12 } }, 'u1', reclassified);
		expect(resized.review?.origin).toBe('10|12|inquire');
	});

	it('is absent on a created item and stays absent on later edits', () => {
		const created = withReview(mkIntent(9.5, 11, 1), { confirmed: false, from: null });
		expect(created.review?.origin).toBeUndefined();
		const moved = stampExtentEdit({ ...created, time_range: { start: 9, end: 10.5 } }, 'u1', created);
		expect(moved.review?.origin).toBeUndefined();
	});
});

describe('reviewedBaselineKeys', () => {
	const baselineIntents = [mkIntent(10, 12, 0.9), mkIntent(20, 22, 0.4, 'inquire'), mkIntent(30, 31, 0.5, 'engage')];
	const baselineWords = [mkWord(4, 4.5, 'um', 0.3)];
	const baseline = buildReviewQueue({ intents: baselineIntents, words: baselineWords });
	const keysFor = (intents: IntentAnnotation[], words: SpeechWord[] = baselineWords) =>
		reviewedBaselineKeys(baseline, { intents, words }, buildReviewQueue({ intents, words }));

	it('is empty when nothing was reviewed', () => {
		expect(keysFor(baselineIntents).size).toBe(0);
	});

	it('keeps a confirmed row', () => {
		const intents = baselineIntents.map((it, i) => (i === 1 ? confirmed(it) : it));
		expect([...keysFor(intents)]).toEqual(['intent|20|22|inquire']);
	});

	it('keeps a reclassified row through its origin', () => {
		const reclassified = withReview(
			{ ...baselineIntents[1], intent_classification: { ...baselineIntents[1].intent_classification, intent: 'comfort' as const } },
			{ confirmed: false, from: baselineIntents[1] },
		);
		expect(keysFor([baselineIntents[0], reclassified, baselineIntents[2]]).has('intent|20|22|inquire')).toBe(true);
	});

	it('keeps a resized row through its origin', () => {
		const resized = stampExtentEdit({ ...baselineWords[0], time_range: { start: 4, end: 4.8 } }, undefined, baselineWords[0]);
		expect(keysFor(baselineIntents, [resized]).has('word|4|4.5|um')).toBe(true);
	});

	it('keeps the row of a split item (either half)', () => {
		const orig = baselineIntents[1];
		const a = stampExtentEdit({ ...orig, time_range: { start: 20, end: 21 } }, undefined, orig);
		const b = stampExtentEdit({ ...orig, time_range: { start: 21, end: 22 } }, undefined, orig);
		expect(keysFor([baselineIntents[0], a, b, baselineIntents[2]]).has('intent|20|22|inquire')).toBe(true);
	});

	it('merge: the lower row stays reviewed, the upper row drops out (neither open nor reviewed)', () => {
		const lower = baselineIntents[1];
		const merged = stampExtentEdit({ ...lower, time_range: { start: 20, end: 31 } }, undefined, lower);
		const intents = [baselineIntents[0], merged];
		const keys = keysFor(intents);
		expect(keys.has('intent|20|22|inquire')).toBe(true);
		expect(keys.has('intent|30|31|engage')).toBe(false);
		expect(buildReviewQueue({ intents }).some((q) => q.key === 'intent|30|31|engage')).toBe(false);
	});

	it('finds the row after an insert shifted indices', () => {
		const intents = [mkIntent(0, 1), baselineIntents[0], confirmed(baselineIntents[1]), baselineIntents[2]];
		expect([...keysFor(intents)]).toEqual(['intent|20|22|inquire']);
	});

	it('drops the row of a deleted item, and reopens a row whose stamp was undone', () => {
		expect(keysFor([baselineIntents[0], baselineIntents[2]]).size).toBe(0);
		expect(keysFor(baselineIntents).size).toBe(0);
	});

	it('does not mark an unreviewed item reviewed when a human item lands on its index and time (skeptic probe)', () => {
		// intents [A, X(0.4) 10–12, C], then a human item at 9.5–11 inserted before X
		const A = mkIntent(2, 4);
		const X = mkIntent(10, 12, 0.4, 'inquire');
		const C = mkIntent(14, 16);
		const base = buildReviewQueue({ intents: [A, X, C] });
		const inserted = withReview(mkIntent(9.5, 11, 1, 'engage'), { confirmed: false, from: null });
		const intents = [A, inserted, X, C];
		const open = buildReviewQueue({ intents });
		const keys = reviewedBaselineKeys(base, { intents }, open);
		expect(keys.has('intent|10|12|inquire')).toBe(false);
		expect(open.map((q) => q.key)).toEqual(['intent|10|12|inquire']);
		const rows = mergeQueueRows(open, base, keys);
		expect(rows.map((q) => q.key)).toEqual(['intent|10|12|inquire']);
	});

	it('never reports a key that is still open', () => {
		// A human item created with an open item's exact range and label
		const X = mkIntent(10, 12, 0.4, 'inquire');
		const base = buildReviewQueue({ intents: [X] });
		const twin = withReview(mkIntent(10, 12, 1, 'inquire'), { confirmed: false, from: null });
		const intents = [X, twin];
		const open = buildReviewQueue({ intents });
		expect(reviewedBaselineKeys(base, { intents }, open).size).toBe(0);
	});
});

describe('queue key uniqueness', () => {
	it('buildReviewQueue lists an exact duplicate once', () => {
		const q = buildReviewQueue({ intents: [mkIntent(10, 12, 0.4), mkIntent(10, 12, 0.4)] });
		expect(q.map((x) => x.key)).toEqual(['intent|10|12|inform']);
	});

	it('mergeQueueRows adds each key once, open rows first', () => {
		const open = buildReviewQueue({ intents: [mkIntent(10, 12, 0.4)] });
		const base = buildReviewQueue({ intents: [mkIntent(5, 6, 0.3), mkIntent(10, 12, 0.4)] });
		const rows = mergeQueueRows(open, base, new Set(['intent|5|6|inform', 'intent|10|12|inform']));
		expect(rows.map((x) => x.key)).toEqual(['intent|5|6|inform', 'intent|10|12|inform']);
		expect(rows[1]).toBe(open[0]);
	});
});

describe('locateQueueItem', () => {
	const X = mkIntent(10, 12, 0.4, 'inquire');
	const row = buildReviewQueue({ intents: [mkIntent(2, 4), X] })[0];

	it('finds the item by key, preferring an unreviewed one', () => {
		expect(locateQueueItem([mkIntent(2, 4), X], row)).toBe(1);
		expect(locateQueueItem([X], row)).toBe(0);
		expect(locateQueueItem([confirmed(X), X], row)).toBe(1);
	});

	it('falls back to the item carrying the row as its origin', () => {
		const moved = stampExtentEdit({ ...X, time_range: { start: 9, end: 12 } }, undefined, X);
		expect(locateQueueItem([mkIntent(2, 4), moved], row)).toBe(1);
		expect(locateQueueItem([mkIntent(2, 4)], row)).toBe(-1);
	});
});
