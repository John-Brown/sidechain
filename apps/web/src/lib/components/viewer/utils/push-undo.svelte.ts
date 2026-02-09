import type { EditorState, EditableType } from '../state/editor.svelte.js';

/** Push an undo snapshot for the given type, unwrapping Svelte 5 proxies first. */
export function pushUndoForType(editor: EditorState, type: EditableType): void {
  switch (type) {
    case 'states':
      if (editor.states) editor.stateHistory.push(structuredClone($state.snapshot(editor.states)));
      break;
    case 'intents':
      if (editor.intents) editor.intentHistory.push(structuredClone($state.snapshot(editor.intents)));
      break;
    case 'transcription':
      if (editor.transcription) editor.transcriptionHistory.push(structuredClone($state.snapshot(editor.transcription)));
      break;
    case 'backchannels':
      if (editor.backchannels) editor.backchannelHistory.push(structuredClone($state.snapshot(editor.backchannels)));
      break;
    case 'userLabels':
      if (editor.userLabels) editor.userLabelHistory.push(structuredClone($state.snapshot(editor.userLabels)));
      break;
  }
}
