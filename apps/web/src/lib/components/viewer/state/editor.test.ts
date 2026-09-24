import { describe, it, expect, vi } from 'vitest';
import { EditorState, isReclassifiable, type EditRecord } from './editor.svelte';
import { AnnotationDataState } from './annotation-data.svelte';
import { AutoSaveState } from './autosave.svelte';
import type { StateAnnotation, IntentAnnotation, SpeechWord } from '@annotation/shared';

const mkMetadata = () => ({
	source_file: 'test.mp4',
	format_version: '1.0',
	created_timestamp: '2026-01-01T00:00:00Z',
	total_secs: 60,
	algorithm: { name: 'test', processing_time: 1 },
});

const mkState = (start: number, end: number, category = 'expression.state.speaking' as const): StateAnnotation => ({
	time_range: { start, end },
	category,
	note: '',
	parameters: {},
});

const mkIntent = (start: number, end: number): IntentAnnotation => ({
	time_range: { start, end },
	intent_classification: {
		intent: 'engage',
		intensity: 'moderate',
		valence: 'neutral',
		confidence: 0.9,
		reasoning: 'test',
	},
});

const mkWord = (start: number, end: number, word: string): SpeechWord => ({
	time_range: { start, end },
	speech: { word, speaker: 'S0', confidence: 0.95, speech_segment: 0 },
});

function setupAnnotationData(): AnnotationDataState {
	const data = new AnnotationDataState();
	data.stateAnnotation = {
		metadata: mkMetadata(),
		data: [mkState(0, 5), mkState(5, 10)],
	};
	data.intentClassification = {
		metadata: mkMetadata(),
		data: [mkIntent(2, 4)],
	};
	data.transcription = {
		metadata: mkMetadata(),
		data: [mkWord(1, 1.5, 'hello'), mkWord(2, 2.5, 'world')],
	};
	return data;
}

describe('EditorState', () => {
	describe('enterEditMode', () => {
		it('clones annotation data into editable arrays', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			expect(editor.editing).toBe(true);
			expect(editor.states).toHaveLength(2);
			expect(editor.intents).toHaveLength(1);
			expect(editor.transcription).toHaveLength(2);
		});

		it('deep-clones so edits do not mutate source data', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			// Mutate the editor copy
			editor.states![0].note = 'modified';

			// Source should be untouched
			expect(data.stateAnnotation!.data[0].note).toBe('');
		});

		it('sets null arrays when source data is null', () => {
			const editor = new EditorState();
			const data = new AnnotationDataState(); // all null
			editor.enterEditMode(data);

			expect(editor.editing).toBe(true);
			expect(editor.states).toBeNull();
			expect(editor.intents).toBeNull();
			expect(editor.transcription).toBeNull();
			expect(editor.backchannels).toBeNull();
		});

		it('clears history on enter', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			// Simulate some history
			editor.stateHistory.push([mkState(0, 10)]);
			expect(editor.stateHistory.canUndo).toBe(true);

			// Re-enter edit mode — history should be cleared
			editor.enterEditMode(data);
			expect(editor.stateHistory.canUndo).toBe(false);
		});

		it('resets lastEditedType on enter', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);
			editor.lastEditedType = 'states';

			editor.enterEditMode(data);
			expect(editor.lastEditedType).toBeNull();
		});
	});

	describe('exitEditMode', () => {
		it('clears all editable arrays and flags', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);
			editor.markDirty('states');
			editor.lastEditedType = 'states';

			editor.exitEditMode();

			expect(editor.editing).toBe(false);
			expect(editor.states).toBeNull();
			expect(editor.intents).toBeNull();
			expect(editor.transcription).toBeNull();
			expect(editor.backchannels).toBeNull();
			expect(editor.lastEditedType).toBeNull();
			expect(editor.hasChanges).toBe(false);
		});

		it('clears all history on exit', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			editor.stateHistory.push([mkState(0, 10)]);
			editor.intentHistory.push([mkIntent(1, 2)]);

			editor.exitEditMode();

			expect(editor.stateHistory.canUndo).toBe(false);
			expect(editor.intentHistory.canUndo).toBe(false);
		});
	});

	describe('dirty tracking', () => {
		it('starts clean', () => {
			const editor = new EditorState();
			expect(editor.hasChanges).toBe(false);
			expect(editor.isDirty('states')).toBe(false);
			expect(editor.getDirtyTypes()).toEqual([]);
		});

		it('markDirty sets type as dirty', () => {
			const editor = new EditorState();
			editor.markDirty('states');

			expect(editor.isDirty('states')).toBe(true);
			expect(editor.isDirty('intents')).toBe(false);
			expect(editor.hasChanges).toBe(true);
		});

		it('getDirtyTypes returns all dirty types', () => {
			const editor = new EditorState();
			editor.markDirty('states');
			editor.markDirty('intents');

			const dirty = editor.getDirtyTypes();
			expect(dirty).toContain('states');
			expect(dirty).toContain('intents');
			expect(dirty).toHaveLength(2);
		});

		it('enterEditMode resets dirty flags', () => {
			const editor = new EditorState();
			editor.markDirty('states');
			expect(editor.hasChanges).toBe(true);

			editor.enterEditMode(setupAnnotationData());
			expect(editor.hasChanges).toBe(false);
			expect(editor.isDirty('states')).toBe(false);
		});
	});

	describe('undo/redo via lastEditedType', () => {
		it('undo returns false when no lastEditedType', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			expect(editor.canUndo).toBe(false);
			expect(editor.undo()).toBe(false);
		});

		it('redo returns false when no lastEditedType', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			expect(editor.canRedo).toBe(false);
			expect(editor.redo()).toBe(false);
		});

		it('undo restores previous state for lastEditedType', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			// Save current state, modify, then undo
			const originalStates = editor.states!;
			editor.stateHistory.push(originalStates);
			editor.states = [mkState(0, 10)]; // modified
			editor.lastEditedType = 'states';

			expect(editor.canUndo).toBe(true);
			const result = editor.undo();
			expect(result).toBe(true);
			expect(editor.states).toHaveLength(2); // restored original
		});

		it('redo restores undone state', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			const originalStates = editor.states!;
			editor.stateHistory.push(originalStates);
			editor.states = [mkState(0, 10)];
			editor.lastEditedType = 'states';

			editor.undo(); // back to original
			expect(editor.canRedo).toBe(true);

			const result = editor.redo();
			expect(result).toBe(true);
			expect(editor.states).toHaveLength(1); // back to modified
		});

		it('undo and redo clear a selection on the restored type only', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			editor.stateHistory.push(editor.states!);
			editor.states = [mkState(0, 10)];
			editor.lastEditedType = 'states';

			editor.select('states', 1);
			editor.undo();
			expect(editor.hasSelection).toBe(false);

			editor.select('intents', 0);
			editor.redo();
			expect(editor.selectedType).toBe('intents');
			expect(editor.selectedIndex).toBe(0);
		});

		it('undo returns false when history is empty', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);
			editor.lastEditedType = 'states';

			// No history pushed
			expect(editor.undo()).toBe(false);
		});

		it('undo returns false when editable data is null', () => {
			const editor = new EditorState();
			const data = new AnnotationDataState(); // all null
			editor.enterEditMode(data);
			editor.lastEditedType = 'states';
			editor.stateHistory.push([mkState(0, 5)]);

			// states is null — undo should bail
			expect(editor.undo()).toBe(false);
		});

		it('canUndo/canRedo track the lastEditedType history', () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			editor.enterEditMode(data);

			// Push history for states but set lastEditedType to intents
			editor.stateHistory.push([mkState(0, 5)]);
			editor.lastEditedType = 'intents';

			// canUndo should check intents history (empty), not states
			expect(editor.canUndo).toBe(false);

			editor.lastEditedType = 'states';
			expect(editor.canUndo).toBe(true);
		});
	});

	describe('edit tracking (recordEdit / getAndClearEdits)', () => {
		it('records and retrieves edits for a type', () => {
			const editor = new EditorState();
			editor.enterEditMode(setupAnnotationData());

			editor.recordEdit('states', {
				editType: 'create',
				targetIndex: null,
				beforeState: null,
				afterState: [mkState(0, 10)],
			});
			editor.recordEdit('states', {
				editType: 'resize',
				targetIndex: 0,
				beforeState: [mkState(0, 10)],
				afterState: [mkState(0, 8)],
			});

			const edits = editor.getAndClearEdits('states');
			expect(edits).toHaveLength(2);
			expect(edits[0].editType).toBe('create');
			expect(edits[1].editType).toBe('resize');
		});

		it('clears edits after getAndClearEdits', () => {
			const editor = new EditorState();
			editor.enterEditMode(setupAnnotationData());

			editor.recordEdit('states', {
				editType: 'delete',
				targetIndex: 0,
				beforeState: null,
				afterState: null,
			});

			editor.getAndClearEdits('states');
			const second = editor.getAndClearEdits('states');
			expect(second).toHaveLength(0);
		});

		it('returns empty array for types with no edits', () => {
			const editor = new EditorState();
			editor.enterEditMode(setupAnnotationData());

			const edits = editor.getAndClearEdits('intents');
			expect(edits).toHaveLength(0);
		});

		it('tracks edits per type independently', () => {
			const editor = new EditorState();
			editor.enterEditMode(setupAnnotationData());

			editor.recordEdit('states', { editType: 'create', targetIndex: null, beforeState: null, afterState: null });
			editor.recordEdit('intents', { editType: 'delete', targetIndex: 0, beforeState: null, afterState: null });

			expect(editor.getAndClearEdits('states')).toHaveLength(1);
			expect(editor.getAndClearEdits('intents')).toHaveLength(1);
		});

		it('resets pending edits on enterEditMode', () => {
			const editor = new EditorState();
			editor.enterEditMode(setupAnnotationData());

			editor.recordEdit('states', { editType: 'create', targetIndex: null, beforeState: null, afterState: null });

			editor.enterEditMode(setupAnnotationData());
			expect(editor.getAndClearEdits('states')).toHaveLength(0);
		});

		it('resets pending edits on exitEditMode', () => {
			const editor = new EditorState();
			editor.enterEditMode(setupAnnotationData());

			editor.recordEdit('states', { editType: 'create', targetIndex: null, beforeState: null, afterState: null });

			editor.exitEditMode();
			// After re-entering, edits should be cleared
			editor.enterEditMode(setupAnnotationData());
			expect(editor.getAndClearEdits('states')).toHaveLength(0);
		});
	});

	describe('confirm', () => {
		function setupLowConf(): EditorState {
			const editor = new EditorState();
			const data = setupAnnotationData();
			data.intentClassification!.data = [mkIntent(2, 4), mkIntent(6, 8)];
			data.intentClassification!.data[1].intent_classification.confidence = 0.4;
			editor.enterEditMode(data);
			return editor;
		}

		it('stamps human confirmed provenance without changing the item', () => {
			const editor = setupLowConf();
			const before = JSON.parse(JSON.stringify(editor.intents![1]));

			expect(editor.confirm('intents', 1, { by: 'user-1' })).toBe(true);

			const after = editor.intents![1];
			expect(after.review).toMatchObject({ source: 'human', confirmed: true, by: 'user-1' });
			expect(typeof after.review!.at).toBe('string');
			expect(after.time_range).toEqual(before.time_range);
			expect(after.intent_classification).toEqual(before.intent_classification);
			// Other items untouched
			expect(editor.intents![0].review).toBeUndefined();
		});

		it('adds the stable key to reviewedKeys and isReviewed', () => {
			const editor = setupLowConf();
			expect(editor.reviewedKeys('intents').size).toBe(0);
			expect(editor.isReviewed('intents', 1)).toBe(false);

			editor.confirm('intents', 1);

			expect(editor.reviewedKeys('intents').has('6|8|engage')).toBe(true);
			expect(editor.isReviewed('intents', 1)).toBe(true);
		});

		it('keeps the reviewed key when items are inserted before it (reindexing)', () => {
			const editor = setupLowConf();
			editor.confirm('intents', 1);
			editor.intents = [mkIntent(0, 1), ...JSON.parse(JSON.stringify(editor.intents!))];

			expect(editor.isReviewed('intents', 2)).toBe(true);
			expect(editor.reviewedKeys('intents').has('6|8|engage')).toBe(true);
		});

		it('marks dirty, sets lastEditedType and records a confirm audit edit', () => {
			const editor = setupLowConf();
			const v = editor.dirtyVersion;
			editor.confirm('intents', 1);

			expect(editor.isDirty('intents')).toBe(true);
			expect(editor.dirtyVersion).toBe(v + 1);
			expect(editor.lastEditedType).toBe('intents');

			const edits = editor.getAndClearEdits('intents');
			expect(edits).toHaveLength(1);
			expect(edits[0].editType).toBe('confirm');
			expect(edits[0].targetIndex).toBe(1);
			expect((edits[0].beforeState as IntentAnnotation).review).toBeUndefined();
			expect((edits[0].afterState as IntentAnnotation).review?.confirmed).toBe(true);
		});

		it('is undoable and redoable', () => {
			const editor = setupLowConf();
			editor.confirm('intents', 1);
			expect(editor.canUndo).toBe(true);

			editor.undo();
			expect(editor.intents![1].review).toBeUndefined();
			expect(editor.isReviewed('intents', 1)).toBe(false);

			editor.redo();
			expect(editor.intents![1].review?.confirmed).toBe(true);
		});

		it('is a no-op for already-reviewed items, bad indices and outside edit mode', () => {
			const editor = setupLowConf();
			editor.confirm('intents', 1);
			editor.getAndClearEdits('intents');

			expect(editor.confirm('intents', 1)).toBe(false);
			expect(editor.confirm('intents', 99)).toBe(false);
			expect(editor.confirm('intents', -1)).toBe(false);
			expect(editor.getAndClearEdits('intents')).toHaveLength(0);

			editor.exitEditMode();
			expect(editor.confirm('intents', 0)).toBe(false);
		});

		it('treats human-only types (user labels) as already reviewed', () => {
			const editor = setupLowConf();
			editor.userLabels = [{ time_range: { start: 1, end: 2 }, text: 'note' }];
			expect(editor.isReviewed('userLabels', 0)).toBe(true);
			expect(editor.confirm('userLabels', 0)).toBe(false);
		});

		it('confirms words and states too', () => {
			const editor = setupLowConf();
			expect(editor.confirm('transcription', 0)).toBe(true);
			expect(editor.confirm('states', 0)).toBe(true);
			expect(editor.transcription![0].review?.confirmed).toBe(true);
			expect(editor.states![0].review?.confirmed).toBe(true);
		});

		it('confirmSelected confirms the current selection', () => {
			const editor = setupLowConf();
			expect(editor.confirmSelected()).toBe(false);
			editor.select('intents', 1);
			expect(editor.confirmSelected()).toBe(true);
			expect(editor.isReviewed('intents', 1)).toBe(true);
		});

		it('pushUndo snapshots the current array', () => {
			const editor = setupLowConf();
			editor.pushUndo('intents');
			expect(editor.intentHistory.undoCount).toBe(1);
		});
	});

	describe('undo/redo persistence (autosave + audit edits)', () => {
		type Saved = { type: string; data: IntentAnnotation[]; edits: EditRecord[] };

		function setup() {
			const editor = new EditorState();
			const data = setupAnnotationData();
			data.intentClassification!.data = [mkIntent(2, 4), mkIntent(6, 8)];
			data.intentClassification!.data[1].intent_classification.confidence = 0.4;
			editor.enterEditMode(data);
			const saves: Saved[] = [];
			const autosave = new AutoSaveState(
				editor,
				'video-1',
				async (_vid, type, d, edits) => {
					saves.push({ type, data: JSON.parse(JSON.stringify(d)), edits });
				},
				{ persistDrafts: false },
			);
			return { editor, autosave, saves };
		}

		it('confirm → save → undo leaves the type dirty, and the next save drops the stamp', async () => {
			const { editor, autosave, saves } = setup();
			editor.confirm('intents', 1);
			await autosave.saveNow();
			expect(saves).toHaveLength(1);
			expect(saves[0].edits.map((e) => e.editType)).toEqual(['confirm']);
			expect(editor.hasChanges).toBe(false);

			expect(editor.undo()).toBe(true);
			expect(editor.hasChanges).toBe(true);
			expect(editor.isDirty('intents')).toBe(true);
			expect(editor.intents![1].review).toBeUndefined();

			await autosave.saveNow();
			expect(saves).toHaveLength(2);
			expect(saves[1].data[1].review).toBeUndefined();
			// The confirm was already audited; the undo sends no second confirm
			expect(saves[1].edits).toHaveLength(0);
			autosave.dispose();
		});

		it('confirm → undo before a save sends no confirm edit', async () => {
			const { editor, autosave, saves } = setup();
			editor.confirm('intents', 1);
			expect(editor.pendingEdits('intents')).toHaveLength(1);

			editor.undo();
			expect(editor.pendingEdits('intents')).toHaveLength(0);
			expect(editor.hasChanges).toBe(true);

			await autosave.saveNow();
			expect(saves).toHaveLength(1);
			expect(saves[0].data[1].review).toBeUndefined();
			expect(saves[0].edits.some((e) => e.editType === 'confirm')).toBe(false);
			autosave.dispose();
		});

		it('redo re-queues the undone edit and marks dirty', async () => {
			const { editor, autosave, saves } = setup();
			editor.confirm('intents', 1);
			editor.undo();
			const v = editor.dirtyVersion;
			expect(editor.redo()).toBe(true);
			expect(editor.dirtyVersion).toBe(v + 1);
			expect(editor.pendingEdits('intents').map((e) => e.editType)).toEqual(['confirm']);

			await autosave.saveNow();
			expect(saves[0].data[1].review?.confirmed).toBe(true);
			expect(saves[0].edits.map((e) => e.editType)).toEqual(['confirm']);
			autosave.dispose();
		});

		it('only withdraws the undone step, keeping earlier pending edits', () => {
			const { editor } = setup();
			editor.confirm('intents', 0);
			editor.confirm('intents', 1);
			editor.undo();
			const pending = editor.pendingEdits('intents');
			expect(pending).toHaveLength(1);
			expect(pending[0].targetIndex).toBe(0);
		});

		it('a new edit after an undo clears the redo step', () => {
			const { editor } = setup();
			editor.confirm('intents', 1);
			editor.undo();
			editor.confirm('intents', 0);
			expect(editor.redo()).toBe(false);
			expect(editor.pendingEdits('intents').map((e) => e.targetIndex)).toEqual([0]);
		});

		it('undo during an in-flight save keeps the type dirty; the next save drops the stamp', async () => {
			const editor = new EditorState();
			const data = setupAnnotationData();
			data.intentClassification!.data = [mkIntent(2, 4), mkIntent(6, 8)];
			editor.enterEditMode(data);
			const saves: Saved[] = [];
			let release!: () => void;
			let first = true;
			const autosave = new AutoSaveState(
				editor,
				'video-1',
				async (_vid, type, d, edits) => {
					saves.push({ type, data: JSON.parse(JSON.stringify(d)), edits });
					if (first) {
						first = false;
						await new Promise<void>((r) => (release = r));
					}
				},
				{ persistDrafts: false },
			);

			editor.confirm('intents', 1);
			const inflight = autosave.saveNow();
			// The request is out: it carries the confirm stamp and its audit edit
			expect(saves).toHaveLength(1);
			expect(saves[0].data[1].review?.confirmed).toBe(true);
			expect(saves[0].edits.map((e) => e.editType)).toEqual(['confirm']);

			// ⌘Z while the save is in flight
			expect(editor.undo()).toBe(true);
			release();
			await inflight;

			// The undo's dirty mark survives the save that was already running
			expect(editor.hasChanges).toBe(true);
			expect(editor.isDirty('intents')).toBe(true);
			expect(autosave.status).toBe('saved');

			await autosave.saveNow();
			expect(saves).toHaveLength(2);
			expect(saves[1].data[1].review).toBeUndefined();
			// Already sent with the first request (documented audit caveat); nothing re-sent
			expect(saves[1].edits).toHaveLength(0);
			expect(editor.hasChanges).toBe(false);
			autosave.dispose();
		});

		it('a saveNow during an in-flight save waits, then saves what is still dirty', async () => {
			const editor = new EditorState();
			editor.enterEditMode(setupAnnotationData());
			const saves: string[] = [];
			let release!: () => void;
			let first = true;
			const autosave = new AutoSaveState(
				editor,
				'video-1',
				async (_vid, type) => {
					saves.push(type);
					if (first) {
						first = false;
						await new Promise<void>((r) => (release = r));
					}
				},
				{ persistDrafts: false },
			);
			editor.confirm('intents', 0);
			const a = autosave.saveNow();
			editor.confirm('states', 0);
			const b = autosave.saveNow();
			release();
			await Promise.all([a, b]);
			expect(saves).toEqual(['intent', 'state']);
			expect(editor.hasChanges).toBe(false);
			autosave.dispose();
		});

		it('a failed save keeps the type dirty and re-queues its audit edits', async () => {
			const editor = new EditorState();
			editor.enterEditMode(setupAnnotationData());
			let fail = true;
			const sent: EditRecord[][] = [];
			const autosave = new AutoSaveState(
				editor,
				'video-1',
				async (_vid, _type, _d, edits) => {
					if (fail) throw new Error('offline');
					sent.push(edits);
				},
				{ persistDrafts: false },
			);
			editor.confirm('intents', 0);
			const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
			await autosave.saveNow();
			quiet.mockRestore();
			expect(autosave.status).toBe('error');
			expect(editor.isDirty('intents')).toBe(true);
			expect(editor.pendingEdits('intents').map((e) => e.editType)).toEqual(['confirm']);

			fail = false;
			await autosave.saveNow();
			expect(sent[0].map((e) => e.editType)).toEqual(['confirm']);
			expect(editor.hasChanges).toBe(false);
			autosave.dispose();
		});

		it('clearDirtyIfUnchanged only clears when the type was not marked since', () => {
			const editor = new EditorState();
			editor.enterEditMode(setupAnnotationData());
			editor.markDirty('intents');
			const v = editor.typeVersion('intents');
			editor.markDirty('intents');
			expect(editor.clearDirtyIfUnchanged('intents', v)).toBe(false);
			expect(editor.isDirty('intents')).toBe(true);
			expect(editor.clearDirtyIfUnchanged('intents', editor.typeVersion('intents'))).toBe(true);
			expect(editor.isDirty('intents')).toBe(false);
		});

		it('stamps confirms with reviewerId when no `by` is passed', () => {
			const { editor } = setup();
			editor.reviewerId = 'user-9';
			editor.confirm('intents', 1);
			expect(editor.intents![1].review?.by).toBe('user-9');
		});
	});

	describe('isReclassifiable', () => {
		it('allows states, intents and user labels only', () => {
			expect(isReclassifiable('states')).toBe(true);
			expect(isReclassifiable('intents')).toBe(true);
			expect(isReclassifiable('userLabels')).toBe(true);
			expect(isReclassifiable('transcription')).toBe(false);
			expect(isReclassifiable('backchannels')).toBe(false);
		});
	});
});
