import { describe, it, expect, afterEach } from 'vitest';
import type { IntentAnnotation, SpeechWord, TaskConstraints } from '@annotation/shared';
import { TaskModeState, reviewScopeFor, overlapTracksFor, taskAccessFor, type TaskInfo } from './task-mode.svelte';
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

	it('falls back to both only without constraints', () => {
		expect(reviewScopeFor(null)).toEqual({ intents: true, words: true });
	});

	it('reviews nothing when the task can edit neither intents nor words', () => {
		expect(reviewScopeFor({ editableTypes: ['state'] })).toEqual({ intents: false, words: false });
		expect(reviewScopeFor({ editableTypes: ['backchannel', 'user_labels'] })).toEqual({ intents: false, words: false });
		expect(reviewScopeFor({ editableTypes: [] })).toEqual({ intents: false, words: false });
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

	it('derives counts over the task scope, leaving out locked ranges', () => {
		tm = new TaskModeState();
		// The locked [0, 1) range holds intent 0, which nobody may confirm: it doesn't count
		tm.activate(mkTask({ editableTypes: ['intent'], lockedTimeRanges: [{ start: 0, end: 1 }] }));
		tm.connectReview(() => ({ current: { intents, words }, baseline: { intents, words } }));

		expect(tm.hasReviewScope).toBe(true);
		expect(tm.reviewedCount).toBe(1);
		expect(tm.totalReviewable).toBe(3);
		expect(tm.lowConfRemaining).toBe(2);

		const rows = Object.fromEntries(tm.checklist.map((r) => [r.id, r]));
		expect(rows['all-reviewed']).toMatchObject({ text: 'Every intent reviewed', meta: '1 / 3', done: false });
		expect(rows['low-confidence']).toMatchObject({ meta: '2 left', done: false });
		expect(rows['no-overlaps'].done).toBe(true);
		expect(rows['locked-untouched']).toMatchObject({ meta: '1', done: true });
		expect(tm.checklistComplete).toBe(false);
	});

	it('can complete the review rows when low-confidence items sit in a locked range', () => {
		tm = new TaskModeState();
		// Intent 1 (0.4) is locked; confirming everything else must finish the review rows
		tm.activate(mkTask({ editableTypes: ['intent'], lockedTimeRanges: [{ start: 2, end: 3 }] }));
		const current = intents.map((it, i) => (i === 1 ? it : withReview(it, { confirmed: true })));
		tm.connectReview(() => ({ current: { intents: current }, baseline: { intents } }));

		expect(tm.lowConfRemaining).toBe(0);
		const rows = Object.fromEntries(tm.checklist.map((r) => [r.id, r]));
		expect(rows['all-reviewed']).toMatchObject({ meta: '3 / 3', done: true });
		expect(rows['low-confidence'].done).toBe(true);
	});

	it('marks the review rows N/A for a task that reviews nothing', () => {
		tm = new TaskModeState();
		tm.activate(mkTask({ editableTypes: ['state'] }));
		tm.connectReview(() => ({ current: { intents, words }, baseline: { intents, words } }));

		expect(tm.hasReviewScope).toBe(false);
		expect(tm.totalReviewable).toBe(0);
		expect(tm.lowConfRemaining).toBe(0);
		const rows = Object.fromEntries(tm.checklist.map((r) => [r.id, r]));
		expect(rows['all-reviewed']).toMatchObject({ meta: 'N/A', done: true, applicable: false });
		expect(rows['low-confidence']).toMatchObject({ meta: 'N/A', done: true, applicable: false });
		expect(rows['no-overlaps'].applicable).toBe(true);
		expect(tm.checklistComplete).toBe(true);
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

describe('taskAccessFor', () => {
	const t = (status: string, assignedTo: string | null = 'u1', assigneeName: string | null = 'Dana') => ({ status, assignedTo, assigneeName });

	it('lets the assignee work on an assigned or in-progress task', () => {
		expect(taskAccessFor(t('in_progress'), 'u1')).toEqual({ editable: true, reason: null });
		expect(taskAccessFor(t('assigned'), 'u1')).toEqual({ editable: true, reason: null });
	});

	it('opens someone else\'s task read-only, naming the assignee', () => {
		expect(taskAccessFor(t('in_progress'), 'sup')).toEqual({ editable: false, reason: 'Read-only: assigned to Dana' });
		expect(taskAccessFor(t('in_progress', 'u1', null), 'sup').reason).toBe('Read-only: assigned to someone else');
		expect(taskAccessFor(t('in_progress'), null).editable).toBe(false);
		expect(taskAccessFor(t('assigned', null), 'u1').reason).toBe('Read-only: not assigned to anyone');
	});

	it('opens a task nobody can work in read-only, with its status', () => {
		expect(taskAccessFor(t('submitted'), 'u1')).toEqual({ editable: false, reason: 'Task is submitted' });
		expect(taskAccessFor(t('under_review'), 'u1').reason).toBe('Task is under review');
		expect(taskAccessFor(t('approved'), 'sup').reason).toBe('Task is approved');
	});
});

describe('TaskModeState editable / read-only', () => {
	let tm: TaskModeState;
	afterEach(() => tm?.dispose());

	it('is editable when activated without a read-only reason, until submitted', () => {
		tm = new TaskModeState();
		expect(tm.editable).toBe(false);
		tm.activate(mkTask(null));
		expect(tm.editable).toBe(true);
		tm.markSubmitted();
		expect(tm.editable).toBe(false);
		expect(tm.readOnlyReason).toBe('Task is submitted');
	});

	it('activates read-only with the reason and no timer', () => {
		tm = new TaskModeState();
		tm.activate(mkTask(null), { readOnlyReason: 'Read-only: assigned to Dana' });
		expect(tm.active).toBe(true);
		expect(tm.editable).toBe(false);
		expect(tm.readOnlyReason).toBe('Read-only: assigned to Dana');
		tm.deactivate();
		expect(tm.readOnlyReason).toBeNull();
	});
});
