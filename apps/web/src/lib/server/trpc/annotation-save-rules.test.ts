import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { TaskConstraints } from '@annotation/shared';
import {
	assertEditsAllowed,
	assertTaskAllowsSave,
	canonicalJson,
	stampReviews,
	type SaveTask,
} from './annotation-save-rules';

const VIDEO = 'video-1';
const USER = 'user-annotator';

const constraints: TaskConstraints = {
	editableTypes: ['intent'],
	allowedOperations: ['confirm', 'classify', 'resize'],
	lockedTimeRanges: [{ start: 42, end: 44.8 }],
};

const task = (over: Partial<SaveTask> = {}): SaveTask => ({
	videoId: VIDEO,
	status: 'in_progress',
	assignedTo: USER,
	constraints,
	...over,
});

function code(fn: () => unknown): string | null {
	try {
		fn();
		return null;
	} catch (e) {
		return e instanceof TRPCError ? e.code : 'NOT_TRPC';
	}
}

describe('assertTaskAllowsSave', () => {
	it('accepts the assignee saving an editable type of an in-progress task', () => {
		expect(code(() => assertTaskAllowsSave(task(), { userId: USER, videoId: VIDEO, type: 'intent' }))).toBeNull();
	});

	it('rejects another video, a task not in progress, another user and a non-editable type', () => {
		const ok = { userId: USER, videoId: VIDEO, type: 'intent' as const };
		expect(code(() => assertTaskAllowsSave(task({ videoId: 'other' }), ok))).toBe('FORBIDDEN');
		expect(code(() => assertTaskAllowsSave(task({ status: 'submitted' }), ok))).toBe('FORBIDDEN');
		expect(code(() => assertTaskAllowsSave(task({ assignedTo: 'someone-else' }), ok))).toBe('FORBIDDEN');
		expect(code(() => assertTaskAllowsSave(task(), { ...ok, type: 'state' }))).toBe('FORBIDDEN');
	});

	it('allows every type when the task has no editableTypes', () => {
		expect(code(() => assertTaskAllowsSave(task({ constraints: null }), { userId: USER, videoId: VIDEO, type: 'state' }))).toBeNull();
	});
});

describe('assertEditsAllowed', () => {
	it('accepts the operations a verify task allows (confirm, classify, resize)', () => {
		const edits = [{ editType: 'confirm' as const }, { editType: 'classify' as const }, { editType: 'resize' as const }];
		expect(code(() => assertEditsAllowed(edits, constraints))).toBeNull();
		expect(code(() => assertEditsAllowed([], constraints))).toBeNull();
	});

	it('rejects an operation outside allowedOperations', () => {
		expect(code(() => assertEditsAllowed([{ editType: 'confirm' }, { editType: 'delete' }], constraints))).toBe('FORBIDDEN');
	});

	it('allows anything without constraints or allowedOperations', () => {
		expect(code(() => assertEditsAllowed([{ editType: 'delete' }], null))).toBeNull();
		expect(code(() => assertEditsAllowed([{ editType: 'delete' }], { editableTypes: ['intent'] }))).toBeNull();
	});
});

describe('canonicalJson', () => {
	it('ignores key order and undefined fields', () => {
		expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
			canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1, z: undefined }),
		);
		expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
	});
});

async function asyncCode(fn: () => Promise<unknown>): Promise<string | null> {
	try {
		await fn();
		return null;
	} catch (e) {
		return e instanceof TRPCError ? e.code : 'NOT_TRPC';
	}
}

describe('stampReviews', () => {
	const NOW = '2026-09-24T12:00:00.000Z';
	const LATER = '2026-09-24T13:00:00.000Z';
	const intent = (start: number, extra: Record<string, unknown> = {}) => ({
		time_range: { start, end: start + 1 },
		intent_classification: { intent: 'inform', intensity: 'moderate', valence: 'neutral', confidence: 0.4, reasoning: 'model' },
		...extra,
	});
	type Out = { review?: Record<string, unknown> }[];
	const annotator = { userId: USER, role: 'annotator' as const, now: NOW };
	const supervisor = { userId: 'user-sup', role: 'supervisor' as const, now: NOW };

	it('passes non-array data and unstamped items through', async () => {
		expect(await stampReviews({ peaks: [] }, null, annotator)).toEqual({ peaks: [] });
		const data = [intent(0), intent(2)];
		expect(await stampReviews(data, null, annotator)).toEqual(data);
	});

	it('sets by and at on a new stamp, whatever the client sent', async () => {
		const data = [intent(0, { review: { source: 'human', confirmed: true, by: 'someone-else', at: '1999-01-01T00:00:00Z' } })];
		const [out] = (await stampReviews(data, [intent(0)], annotator)) as Out;
		expect(out.review).toEqual({ source: 'human', confirmed: true, by: USER, at: NOW });
	});

	it('keeps a stamp carried over unchanged from the previous version', async () => {
		const stamp = { source: 'supervisor_override', confirmed: true, by: 'user-sup', at: '2026-09-01T00:00:00Z' };
		// Postgres jsonb reorders keys: the previous version's key order differs
		const previous = [{ review: { at: stamp.at, by: stamp.by, confirmed: true, source: stamp.source }, ...intent(0) }];
		const data = [intent(0, { review: stamp }), intent(2)];
		const out = (await stampReviews(data, previous, annotator)) as Out;
		expect(out[0].review).toEqual(stamp);
	});

	describe('no by/at drift (R3)', () => {
		it("keeps the previous version's by/at for an unchanged item, ignoring the client's local values", async () => {
			// v1: the client confirmed item 0 locally at 11:59, the server stamped it 12:00
			const client = { source: 'human', confirmed: true, by: USER, at: '2026-09-24T11:59:00.000Z', origin: '0|1|inform' };
			const v1 = (await stampReviews([intent(0, { review: client }), intent(2)], [intent(0), intent(2)], annotator)) as Out;
			expect(v1[0].review).toEqual({ ...client, at: NOW });

			// v2, an hour later: the client still holds its local stamp on item 0 and confirms item 1
			const v2data = [
				intent(0, { review: client }),
				intent(2, { review: { source: 'human', confirmed: true, at: 'local', origin: '2|3|inform' } }),
			];
			const v2 = (await stampReviews(v2data, v1, { ...annotator, now: LATER })) as Out;
			expect(v2[0].review).toEqual({ ...client, at: NOW }); // not LATER
			expect(v2[1].review).toMatchObject({ by: USER, at: LATER });
		});

		it('matches the same item after an index shift (insert or delete before it)', async () => {
			const kept = { source: 'human', confirmed: true, by: 'user-a', at: '2026-09-01T00:00:00Z' };
			const previous = [intent(0), intent(4, { review: kept })];
			const data = [intent(4, { review: { source: 'human', confirmed: true, by: USER, at: 'local' } })];
			const [out] = (await stampReviews(data, previous, annotator)) as Out;
			expect(out.review).toEqual(kept);
		});

		it('keeps a stored origin when the client omits it', async () => {
			const stored = { source: 'human', confirmed: true, by: 'user-a', at: '2026-09-01T00:00:00Z', origin: '0|1|inform' };
			const [out] = (await stampReviews([intent(0, { review: { source: 'human', confirmed: true } })], [intent(0, { review: stored })], annotator)) as Out;
			expect(out.review).toEqual(stored);
		});

		it('treats a changed source or confirmed flag as a new stamp', async () => {
			const previous = [intent(0, { review: { source: 'human', confirmed: false, by: 'user-a', at: '2026-09-01T00:00:00Z' } })];
			const [out] = (await stampReviews([intent(0, { review: { source: 'human', confirmed: true } })], previous, annotator)) as Out;
			expect(out.review).toEqual({ source: 'human', confirmed: true, by: USER, at: NOW });
		});
	});

	it('treats a stamp on changed content as new (reclassify, resize)', async () => {
		const stamp = { source: 'human', confirmed: false, by: 'old', at: '2026-09-01T00:00:00Z' };
		const previous = [intent(0, { review: stamp })];
		const moved = { ...intent(0, { review: stamp }), time_range: { start: 0, end: 1.5 } };
		const [out] = (await stampReviews([moved], previous, annotator)) as Out;
		expect(out.review).toMatchObject({ by: USER, at: NOW });
	});

	it('rejects a new supervisor_override stamp from an annotator', async () => {
		const data = [intent(0, { review: { source: 'supervisor_override', confirmed: true, by: 'user-admin' } })];
		expect(await asyncCode(() => stampReviews(data, [intent(0)], annotator))).toBe('FORBIDDEN');
		// A history lookup that finds nothing refuses it too
		expect(await asyncCode(() => stampReviews(data, [intent(0)], { ...annotator, stampExistsInHistory: async () => false }))).toBe('FORBIDDEN');
	});

	describe('undo restoring a supervisor stamp (R2)', () => {
		const supStamp = { source: 'supervisor_override', confirmed: true, by: 'user-sup', at: '2026-09-01T00:00:00Z' };
		const original = intent(0, { review: supStamp });
		// v2: the annotator resized it, so it was re-stamped human
		const resized = { ...intent(0, { review: { source: 'human', confirmed: false, by: USER, at: NOW } }), time_range: { start: 0, end: 1.5 } };

		it('accepts the exact item from an earlier version and keeps the stamp unchanged', async () => {
			const history = [[original], [resized]];
			const seen: unknown[] = [];
			const stampExistsInHistory = async (item: Record<string, unknown>) => {
				seen.push(item);
				return history.some((v) => v.some((x) => canonicalJson(x) === canonicalJson(item)));
			};
			const [out] = (await stampReviews([original], [resized], { ...annotator, now: LATER, stampExistsInHistory })) as Out;
			expect(out.review).toEqual(supStamp); // by and at not overwritten
			expect(seen).toEqual([original]);
		});

		it('refuses a supervisor stamp moved onto different content, or with a different by/at', async () => {
			const history = [[original], [resized]];
			const stampExistsInHistory = async (item: Record<string, unknown>) =>
				history.some((v) => v.some((x) => canonicalJson(x) === canonicalJson(item)));
			const elsewhere = intent(5, { review: supStamp });
			const reattributed = intent(0, { review: { ...supStamp, at: '2026-09-02T00:00:00Z' } });
			for (const item of [elsewhere, reattributed]) {
				expect(await asyncCode(() => stampReviews([item], [resized], { ...annotator, stampExistsInHistory }))).toBe('FORBIDDEN');
			}
		});

		it('refuses a restored supervisor stamp with by/at stripped, without consulting history', async () => {
			let called = false;
			// A permissive (containment-style) lookup must not be reached: the stamp is not identical to any stored one
			const stampExistsInHistory = async () => ((called = true), true);
			const { by: _by, at: _at, ...unattributed } = supStamp;
			const stripped = intent(0, { review: unattributed });
			expect(await asyncCode(() => stampReviews([stripped], [resized], { ...annotator, stampExistsInHistory }))).toBe('FORBIDDEN');
			expect(called).toBe(false);
		});

		it('does not consult history for a privileged caller', async () => {
			let called = false;
			const [out] = (await stampReviews([intent(0, { review: { source: 'supervisor_override', confirmed: true } })], null, {
				...supervisor,
				stampExistsInHistory: async () => ((called = true), false),
			})) as Out;
			expect(called).toBe(false);
			expect(out.review).toEqual({ source: 'supervisor_override', confirmed: true, by: 'user-sup', at: NOW });
		});
	});

	it('accepts supervisor_override from a supervisor, stamped with their id', async () => {
		const data = [intent(0, { review: { source: 'supervisor_override', confirmed: true } })];
		const [out] = (await stampReviews(data, null, supervisor)) as Out;
		expect(out.review).toEqual({ source: 'supervisor_override', confirmed: true, by: 'user-sup', at: NOW });
	});

	it('accepts and keeps a string origin, and rejects malformed stamps', async () => {
		const [out] = (await stampReviews([intent(0, { review: { source: 'human', confirmed: true, origin: '0|1|inform' } })], null, annotator)) as Out;
		expect(out.review).toEqual({ source: 'human', confirmed: true, origin: '0|1|inform', by: USER, at: NOW });

		expect(await asyncCode(() => stampReviews([intent(0, { review: { source: 'robot', confirmed: true } })], null, supervisor))).toBe('BAD_REQUEST');
		expect(await asyncCode(() => stampReviews([intent(0, { review: { source: 'human' } })], null, supervisor))).toBe('BAD_REQUEST');
		expect(await asyncCode(() => stampReviews([intent(0, { review: 'yes' })], null, supervisor))).toBe('BAD_REQUEST');
		expect(await asyncCode(() => stampReviews([intent(0, { review: { source: 'human', confirmed: true, origin: 7 } })], null, supervisor))).toBe('BAD_REQUEST');
	});

	it('does not mutate the input', async () => {
		const data = [intent(0, { review: { source: 'human', confirmed: true, by: 'x' } })];
		const copy = JSON.parse(JSON.stringify(data));
		await stampReviews(data, null, annotator);
		expect(data).toEqual(copy);
	});
});
