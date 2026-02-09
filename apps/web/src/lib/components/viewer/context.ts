import { getContext, setContext } from 'svelte';
import type { TimelineState } from './state/timeline.svelte.js';
import type { AnnotationDataState } from './state/annotation-data.svelte.js';
import type { SessionState } from './state/session.svelte.js';
import type { EditorState } from './state/editor.svelte.js';
import type { TaskModeState } from './state/task-mode.svelte.js';

const TIMELINE_KEY = Symbol('timeline');
const ANNOTATION_DATA_KEY = Symbol('annotation-data');
const SESSION_KEY = Symbol('session');
const EDITOR_KEY = Symbol('editor');
const TASK_MODE_KEY = Symbol('task-mode');

export function setTimelineState(state: TimelineState) {
  setContext(TIMELINE_KEY, state);
}
export function getTimelineState(): TimelineState {
  return getContext<TimelineState>(TIMELINE_KEY);
}

export function setAnnotationDataState(state: AnnotationDataState) {
  setContext(ANNOTATION_DATA_KEY, state);
}
export function getAnnotationDataState(): AnnotationDataState {
  return getContext<AnnotationDataState>(ANNOTATION_DATA_KEY);
}

export function setSessionState(state: SessionState) {
  setContext(SESSION_KEY, state);
}
export function getSessionState(): SessionState {
  return getContext<SessionState>(SESSION_KEY);
}

export function setEditorState(state: EditorState) {
  setContext(EDITOR_KEY, state);
}
export function getEditorState(): EditorState {
  return getContext<EditorState>(EDITOR_KEY);
}

export function setTaskModeState(state: TaskModeState) {
  setContext(TASK_MODE_KEY, state);
}
export function getTaskModeState(): TaskModeState {
  return getContext<TaskModeState>(TASK_MODE_KEY);
}
