import { describe, it, expect, afterEach } from 'vitest';
import type { IntentAnnotation, SpeechWord, TaskConstraints } from '@annotation/shared';
import { TaskModeState, reviewScopeFor, overlapTracksFor, type TaskInfo } from './task-mode.svelte';
import { withReview } from '../review';

const mkIntent = (start: number, end: number, confidence = 0.9): IntentAnnotation => ({
	time_range: { start, end },
	intent_classification: { intent: 'inform', intensity: 'moderate', valence: 'neutral', confidence, reasoning: 'model' },
});

const mkWord = (start: number, end: number, confidence: number): SpeechWord => ({
	time_range: { start, end },
	speech: { word: 'w', speaker: 'S0', confidence, speech_segment: 0 },
});

const mkTask = (constraints: TaskConstraints | null): TaskInfo => ({
	id: 't1',
	videoId: 'v1',
	taskType: 'verify_intents',
	status: 'in_progress',
	constraints,
	reviewNotes: null,
	reviewResult: null,
});

describe('reviewScopeFor', () => {
	it('maps editable types to review kinds', () => {
		expect(reviewScopeFor({ editableTypes: ['intent'] })).toEqual({ intents: true, words: false });
		expect(reviewScopeFor({ editableTypes: ['transcription'] })).toEqual({ intents: false, words: true });
		expect(reviewScopeFor({ editableTypes: ['intent', 'transcription'] })).toEqual({ intents: true, words: true });
	});

	it('falls back to both without reviewable types', () => {
		expect(reviewScopeFor(null)).toEqual({ intents: true, words: true });
		expect(reviewScopeFor({ editableTypes: ['state'] })).toEqual({ intents: true, words: true });
	});
});

describe('overlapTracksFor', () => {
	it('maps editable types to tracks, defaulting to intents', () => {
		expect(overlapTracksFor({ editableTypes: ['intent', 'state'] })).toEqual(['intents', 'states']);
		expect(overlapTracksFor({ editableTypes: ['user_labels'] })).toEqual(['intents']);
		expect(overlapTracksFor(null)).toEqual(['intents']);
	});
});

describe('TaskModeState review counters', () => {
	let tm: TaskModeState;
	afterEach(() => tm?.dispose());

	const intents = [
		mkIntent(0, 1, 0.9),
		mkIntent(2, 3, 0.4),
		withReview(mkIntent(4, 5, 0.3), { confirmed: true }),
		mkIntent(6, 7, 0.5),
	];
	const words = [mkWord(0, 0.2, 0.1)];

	it('reports zeros and a trivially done checklist when not connected', () => {
		tm = new TaskModeState();
		expect(tm.reviewedCount).toBe(0);
		expect(tm.totalReviewable).toBe(0);
		expect(tm.lowConfRemaining).toBe(0);
		expect(tm.checklist).toHaveLength(4);
		expect(tm.checklistComplete).toBe(true);
	});

	it('derives counts over the task scope', () => {
		tm = new TaskModeState();
		tm.activate(mkTask({ editableTypes: ['intent'], lockedTimeRanges: [{ start: 0, end: 1 }] }));
		tm.connectReview(() => ({ current: { intents, words }, baseline: { intents, words } }));

		expect(tm.reviewedCount).toBe(1);
		expect(tm.totalReviewable).toBe(4);
		expect(tm.lowConfRemaining).toBe(2);

		const rows = Object.fromEntries(tm.checklist.map((r) => [r.id, r]));
		expect(rows['all-reviewed']).toMatchObject({ text: 'Every intent reviewed', meta: '1 / 4', done: false });
		expect(rows['low-confidence']).toMatchObject({ meta: '2 left', done: false });
		expect(rows['no-overlaps'].done).toBe(true);
		expect(rows['locked-untouched']).toMatchObject({ meta: '1', done: true });
		expect(tm.checklistComplete).toBe(false);
	});

	it('re-reads the source on every access', () => {
		tm = new TaskModeState();
		tm.activate(mkTask({ editableTypes: ['intent'] }));
		let current = intents;
		tm.connectReview(() => ({ current: { intents: current } }));
		expect(tm.lowConfRemaining).toBe(2);

		current = intents.map((i) => withReview(i, { confirmed: true }));
		expect(tm.lowConfRemaining).toBe(0);
		expect(tm.reviewedCount).toBe(4);
		expect(tm.checklistComplete).toBe(true);
	});

	it('detects edits inside locked ranges', () => {
		tm = new TaskModeState();
		tm.activate(mkTask({ editableTypes: ['intent'], lockedTimeRanges: [{ start: 0, end: 1 }] }));
		tm.connectReview(() => ({ current: { intents: [mkIntent(0, 0.5), ...intents.slice(1)] }, baseline: { intents } }));
		expect(tm.checklist.find((r) => r.id === 'locked-untouched')!.done).toBe(false);
	});

	it('keeps the existing API intact', () => {
		tm = new TaskModeState();
		tm.activate(mkTask({ editableTypes: ['intent'], allowedOperations: ['confirm', 'classify'] }));
		expect(tm.active).toBe(true);
		expect(tm.isTypeEditable('intent')).toBe(true);
		expect(tm.isOperationAllowed('confirm')).toBe(true);
		expect(tm.isOperationAllowed('delete')).toBe(false);
		tm.deactivate();
		expect(tm.active).toBe(false);
	});
});
