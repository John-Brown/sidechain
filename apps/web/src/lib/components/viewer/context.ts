import { getContext, setContext } from 'svelte';
import type { TimelineState } from './state/timeline.svelte.js';
import type { AnnotationDataState } from './state/annotation-data.svelte.js';
import type { SessionState } from './state/session.svelte.js';

const TIMELINE_KEY = Symbol('timeline');
const ANNOTATION_DATA_KEY = Symbol('annotation-data');
const SESSION_KEY = Symbol('session');

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
