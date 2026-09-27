/**
 * Track layout: one config array for every timeline track (replaces the
 * parallel TrackLabel / TrackContent lists in AnnotationViewer).
 *
 * Owns height, collapse and order per track, collapse per group, the per-mode
 * defaults from the design (view/edit vs task), and per-user persistence in
 * localStorage. Resize and reorder are committed here on pointerup/drop only;
 * the drag itself moves a transform-positioned guide and never writes state.
 *
 * The time ruler is not a track here: it is fixed at the top, RULER_HEIGHT.
 */

import type { EditableType } from './editor.svelte.js';

export type TrackGroup = 'audio' | 'face' | 'annotations';
export type TrackKind = 'canvas' | 'dom' | 'editable';
export type ViewerMode = 'view' | 'edit' | 'task';

export type TrackId =
  | 'waveform'
  | 'vad'
  | 'diarization'
  | 'mouth_energy'
  | 'head_pose'
  | 'transcription'
  | 'states'
  | 'intents'
  | 'backchannels'
  | 'user_labels';

export interface TrackConfig {
  id: TrackId;
  label: string;
  group: TrackGroup;
  /** Expanded height in px (what the resize handle edits) */
  height: number;
  minHeight: number;
  maxHeight: number;
  collapsed: boolean;
  /** Position within its group, 0-based and contiguous */
  order: number;
  kind: TrackKind;
  /** EditorState array for editable tracks */
  editableType?: EditableType;
}

export interface TrackGroupView {
  id: TrackGroup;
  label: string;
  collapsed: boolean;
  /** Tracks in order. Empty when the group is collapsed (visibleTracks only). */
  tracks: TrackConfig[];
}

export const TRACK_GROUPS: readonly TrackGroup[] = ['audio', 'face', 'annotations'];

export const GROUP_LABELS: Record<TrackGroup, string> = {
  audio: 'Audio',
  face: 'Face',
  annotations: 'Annotations',
};

/** Group header row height (px) */
export const GROUP_HEADER_HEIGHT = 22;
/** Height of a collapsed track: a thin read-only strip (px) */
export const COLLAPSED_TRACK_HEIGHT = 18;
/** Time ruler height (px) */
export const RULER_HEIGHT = 28;

interface TrackSpec {
  id: TrackId;
  label: string;
  group: TrackGroup;
  kind: TrackKind;
  editableType?: EditableType;
  minHeight: number;
  maxHeight: number;
  /** view/edit height, task height (design `h` object) */
  height: { default: number; task: number };
  /** Stays open in task mode even when not editable (reading context) */
  taskContext?: boolean;
}

/** Track catalogue in default order. Heights are the `h` object in timeline-screen.html. */
const TRACK_SPECS: readonly TrackSpec[] = [
  { id: 'waveform', label: 'Waveform', group: 'audio', kind: 'canvas', minHeight: 48, maxHeight: 240, height: { default: 112, task: 88 } },
  { id: 'vad', label: 'VAD', group: 'audio', kind: 'canvas', minHeight: 24, maxHeight: 120, height: { default: 40, task: 32 } },
  { id: 'diarization', label: 'Diarization', group: 'audio', kind: 'canvas', minHeight: 20, maxHeight: 80, height: { default: 28, task: 28 } },
  { id: 'mouth_energy', label: 'Mouth energy', group: 'face', kind: 'canvas', minHeight: 24, maxHeight: 160, height: { default: 44, task: 44 } },
  { id: 'head_pose', label: 'Head pose', group: 'face', kind: 'canvas', minHeight: 40, maxHeight: 200, height: { default: 72, task: 72 } },
  { id: 'transcription', label: 'Transcription', group: 'annotations', kind: 'editable', editableType: 'transcription', minHeight: 28, maxHeight: 120, height: { default: 44, task: 48 }, taskContext: true },
  { id: 'states', label: 'States', group: 'annotations', kind: 'editable', editableType: 'states', minHeight: 18, maxHeight: 80, height: { default: 32, task: 32 } },
  { id: 'intents', label: 'Intents', group: 'annotations', kind: 'editable', editableType: 'intents', minHeight: 28, maxHeight: 160, height: { default: 48, task: 72 } },
  { id: 'backchannels', label: 'Backchannels', group: 'annotations', kind: 'editable', editableType: 'backchannels', minHeight: 18, maxHeight: 80, height: { default: 32, task: 32 } },
  { id: 'user_labels', label: 'User labels', group: 'annotations', kind: 'editable', editableType: 'userLabels', minHeight: 18, maxHeight: 80, height: { default: 32, task: 32 } },
];

export interface LayoutDefaultsOptions {
  /** Editor types the task may edit (task mode only). Everything else non-context collapses. */
  editableTypes?: readonly EditableType[];
}

export function clampHeight(track: Pick<TrackConfig, 'minHeight' | 'maxHeight'>, px: number): number {
  if (!Number.isFinite(px)) return track.minHeight;
  return Math.round(Math.min(track.maxHeight, Math.max(track.minHeight, px)));
}

/**
 * Default track configs for a mode. Task mode uses the task heights, collapses
 * the Face group, and collapses editable-kind tracks the task can't edit
 * (except transcription, kept open as reading context), matching the design.
 */
export function defaultTrackConfigs(mode: ViewerMode, opts: LayoutDefaultsOptions = {}): TrackConfig[] {
  const isTask = mode === 'task';
  const editable = new Set(opts.editableTypes ?? []);
  const orderInGroup: Record<TrackGroup, number> = { audio: 0, face: 0, annotations: 0 };

  return TRACK_SPECS.map((spec) => {
    const collapsed =
      isTask && spec.kind === 'editable' && !spec.taskContext && !(spec.editableType && editable.has(spec.editableType));
    const cfg: TrackConfig = {
      id: spec.id,
      label: spec.label,
      group: spec.group,
      height: isTask ? spec.height.task : spec.height.default,
      minHeight: spec.minHeight,
      maxHeight: spec.maxHeight,
      collapsed,
      order: orderInGroup[spec.group]++,
      kind: spec.kind,
    };
    if (spec.editableType) cfg.editableType = spec.editableType;
    return cfg;
  });
}

export function defaultGroupCollapsed(mode: ViewerMode): Record<TrackGroup, boolean> {
  return { audio: false, face: mode === 'task', annotations: false };
}

// --- Persistence ---

const STORAGE_VERSION = 1;

interface PersistedLayout {
  v: number;
  tracks: Partial<Record<TrackId, { height?: number; collapsed?: boolean; order?: number }>>;
  groups: Partial<Record<TrackGroup, boolean>>;
}

/** View and edit share one layout; task mode has its own (different heights and collapse defaults). */
export type LayoutClass = 'default' | 'task';

export function layoutClass(mode: ViewerMode): LayoutClass {
  return mode === 'task' ? 'task' : 'default';
}

export function layoutStorageKey(userId: string | null | undefined, mode: ViewerMode): string {
  return `sidechain:tracks:v${STORAGE_VERSION}:${userId || 'anon'}:${layoutClass(mode)}`;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Overlay persisted values on defaults: unknown ids ignored, heights clamped, orders renormalised. */
export function applyPersisted(
  tracks: TrackConfig[],
  groups: Record<TrackGroup, boolean>,
  saved: unknown,
): { tracks: TrackConfig[]; groups: Record<TrackGroup, boolean> } {
  if (!saved || typeof saved !== 'object' || (saved as PersistedLayout).v !== STORAGE_VERSION) {
    return { tracks, groups };
  }
  const p = saved as PersistedLayout;
  const nextTracks = tracks.map((t) => {
    const s = p.tracks?.[t.id];
    if (!s || typeof s !== 'object') return t;
    return {
      ...t,
      height: typeof s.height === 'number' ? clampHeight(t, s.height) : t.height,
      collapsed: typeof s.collapsed === 'boolean' ? s.collapsed : t.collapsed,
      order: typeof s.order === 'number' && Number.isFinite(s.order) ? s.order : t.order,
    };
  });
  const nextGroups = { ...groups };
  for (const g of TRACK_GROUPS) {
    const v = p.groups?.[g];
    if (typeof v === 'boolean') nextGroups[g] = v;
  }
  return { tracks: normaliseOrder(nextTracks), groups: nextGroups };
}

/** Sort by (group, order) and rewrite order as 0..n-1 within each group. Returns new objects. */
function normaliseOrder(tracks: TrackConfig[]): TrackConfig[] {
  const out: TrackConfig[] = [];
  for (const g of TRACK_GROUPS) {
    tracks
      .filter((t) => t.group === g)
      .sort((a, b) => a.order - b.order)
      .forEach((t, i) => out.push({ ...t, order: i }));
  }
  return out;
}

export interface TrackLayoutOptions extends LayoutDefaultsOptions {
  /** Persistence namespace; null/undefined uses "anon" */
  userId?: string | null;
  mode?: ViewerMode;
  /** Injected for tests; defaults to localStorage when available */
  storage?: Storage | null;
}

export class TrackLayoutState {
  mode: ViewerMode = $state('view');
  tracks: TrackConfig[] = $state([]);
  groupCollapsed: Record<TrackGroup, boolean> = $state({ audio: false, face: false, annotations: false });

  /**
   * Tracks that have data (or a loading/error placeholder) to show. null means
   * all. Set by the viewer from load status; hidden tracks keep their config.
   */
  available: ReadonlySet<TrackId> | null = $state(null);

  #userId: string | null;
  #storage: Storage | null;
  #editableTypes: readonly EditableType[];

  constructor(opts: TrackLayoutOptions = {}) {
    this.#userId = opts.userId ?? null;
    this.#storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.#editableTypes = opts.editableTypes ?? [];
    this.#load(opts.mode ?? 'view');
  }

  /**
   * Switch mode (e.g. task activation). View and edit share one layout, so
   * ⌘E keeps heights, collapse and order; entering or leaving task mode loads
   * that layout's defaults + saved values.
   */
  setMode(mode: ViewerMode, opts: LayoutDefaultsOptions = {}): void {
    const editableChanged =
      opts.editableTypes !== undefined &&
      (opts.editableTypes.length !== this.#editableTypes.length ||
        opts.editableTypes.some((t, i) => t !== this.#editableTypes[i]));
    if (opts.editableTypes) this.#editableTypes = opts.editableTypes;
    if (layoutClass(mode) === layoutClass(this.mode) && !(mode === 'task' && editableChanged)) {
      this.mode = mode;
      return;
    }
    this.#load(mode);
  }

  /** Change the persistence user (after auth resolves) and reload. */
  setUser(userId: string | null): void {
    this.#userId = userId;
    this.#load(this.mode);
  }

  /** Drop the saved layout for this mode's layout class and restore defaults. */
  reset(): void {
    try {
      this.#storage?.removeItem(layoutStorageKey(this.#userId, this.mode));
    } catch {
      // storage unavailable: non-fatal
    }
    this.tracks = defaultTrackConfigs(this.mode, { editableTypes: this.#editableTypes });
    this.groupCollapsed = defaultGroupCollapsed(this.mode);
  }

  get(id: TrackId): TrackConfig | undefined {
    return this.tracks.find((t) => t.id === id);
  }

  /** Height the row renders at right now (collapsed strip or its height). */
  renderHeight(id: TrackId): number {
    const t = this.get(id);
    if (!t) return 0;
    return t.collapsed ? COLLAPSED_TRACK_HEIGHT : t.height;
  }

  isGroup(value: string): value is TrackGroup {
    return (TRACK_GROUPS as readonly string[]).includes(value);
  }

  /** Toggle a track's or a whole group's collapse. Returns the new collapsed value. */
  toggleCollapse(idOrGroup: TrackId | TrackGroup): boolean {
    if (this.isGroup(idOrGroup)) {
      const next = !this.groupCollapsed[idOrGroup];
      this.groupCollapsed = { ...this.groupCollapsed, [idOrGroup]: next };
      this.#save();
      return next;
    }
    const t = this.get(idOrGroup);
    if (!t) return false;
    const next = !t.collapsed;
    this.#update(idOrGroup, { collapsed: next });
    this.#save();
    return next;
  }

  /** Commit a resize (pointerup). Clamped to the track's bounds; returns the applied height. */
  setHeight(id: TrackId, px: number): number {
    const t = this.get(id);
    if (!t) return 0;
    const height = clampHeight(t, px);
    if (height !== t.height) {
      this.#update(id, { height });
      this.#save();
    }
    return height;
  }

  /**
   * Move a track up (delta < 0) or down within its group (⌥↑ / ⌥↓), stepping
   * over tracks that aren't available (not rendered). Returns false at the edge.
   */
  move(id: TrackId, delta: number): boolean {
    const t = this.get(id);
    if (!t || delta === 0) return false;
    const siblings = this.#groupTracks(t.group);
    const avail = this.available;
    const shown = siblings.filter((s) => !avail || avail.has(s.id) || s.id === id);
    const shownFrom = shown.findIndex((s) => s.id === id);
    const shownTo = Math.max(0, Math.min(shown.length - 1, shownFrom + Math.trunc(delta)));
    if (shownTo === shownFrom) return false;
    const from = siblings.findIndex((s) => s.id === id);
    const to = siblings.findIndex((s) => s.id === shown[shownTo].id);
    return this.#placeAt(t.group, from, to);
  }

  /** Drop `fromId` at `toId`'s position (grip drag). Only within the same group. */
  reorder(fromId: TrackId, toId: TrackId): boolean {
    if (fromId === toId) return false;
    const a = this.get(fromId);
    const b = this.get(toId);
    if (!a || !b || a.group !== b.group) return false;
    const siblings = this.#groupTracks(a.group);
    const from = siblings.findIndex((s) => s.id === fromId);
    const to = siblings.findIndex((s) => s.id === toId);
    return this.#placeAt(a.group, from, to);
  }

  /** All tracks grouped and ordered, regardless of collapse or availability. */
  get grouped(): TrackGroupView[] {
    return TRACK_GROUPS.map((g) => ({
      id: g,
      label: GROUP_LABELS[g],
      collapsed: this.groupCollapsed[g],
      tracks: this.#groupTracks(g),
    }));
  }

  /**
   * What the timeline renders: groups that have at least one available track,
   * each with its available tracks in order (none when the group is
   * collapsed; its header still renders). Render each track at renderHeight().
   */
  get visibleTracks(): TrackGroupView[] {
    const avail = this.available;
    const out: TrackGroupView[] = [];
    for (const g of TRACK_GROUPS) {
      const tracks = this.#groupTracks(g).filter((t) => !avail || avail.has(t.id));
      if (tracks.length === 0) continue;
      const collapsed = this.groupCollapsed[g];
      out.push({ id: g, label: GROUP_LABELS[g], collapsed, tracks: collapsed ? [] : tracks });
    }
    return out;
  }

  /** Flat list of rendered tracks, top to bottom. */
  get visibleTrackList(): TrackConfig[] {
    return this.visibleTracks.flatMap((g) => g.tracks);
  }

  /** Total rendered height of groups + tracks below the ruler (px). */
  get totalHeight(): number {
    let h = 0;
    for (const g of this.visibleTracks) {
      h += GROUP_HEADER_HEIGHT;
      for (const t of g.tracks) h += t.collapsed ? COLLAPSED_TRACK_HEIGHT : t.height;
    }
    return h;
  }

  // --- internals ---

  #groupTracks(group: TrackGroup): TrackConfig[] {
    return this.tracks.filter((t) => t.group === group).sort((a, b) => a.order - b.order);
  }

  #placeAt(group: TrackGroup, from: number, to: number): boolean {
    if (from < 0 || to < 0 || from === to) return false;
    const siblings = this.#groupTracks(group).map((t) => t.id);
    const [moved] = siblings.splice(from, 1);
    siblings.splice(to, 0, moved);
    const orderOf = new Map(siblings.map((id, i) => [id, i]));
    this.tracks = this.tracks.map((t) => (t.group === group ? { ...t, order: orderOf.get(t.id)! } : t));
    this.#save();
    return true;
  }

  #update(id: TrackId, patch: Partial<TrackConfig>): void {
    this.tracks = this.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  }

  #load(mode: ViewerMode): void {
    this.mode = mode;
    const tracks = defaultTrackConfigs(mode, { editableTypes: this.#editableTypes });
    const groups = defaultGroupCollapsed(mode);
    let saved: unknown = null;
    try {
      const raw = this.#storage?.getItem(layoutStorageKey(this.#userId, mode));
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
    }
    const merged = applyPersisted(tracks, groups, saved);
    this.tracks = merged.tracks;
    this.groupCollapsed = merged.groups;
  }

  #save(): void {
    const data: PersistedLayout = { v: STORAGE_VERSION, tracks: {}, groups: { ...this.groupCollapsed } };
    for (const t of this.tracks) {
      data.tracks[t.id] = { height: t.height, collapsed: t.collapsed, order: t.order };
    }
    try {
      this.#storage?.setItem(layoutStorageKey(this.#userId, this.mode), JSON.stringify(data));
    } catch {
      // quota exceeded / blocked storage: layout just won't persist
    }
  }
}
