import { describe, it, expect } from 'vitest';
import { EditorState } from './editor.svelte';
import { AnnotationDataState } from './annotation-data.svelte';
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
});
