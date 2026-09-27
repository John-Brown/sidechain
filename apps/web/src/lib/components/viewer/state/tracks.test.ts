import { describe, it, expect, beforeEach } from 'vitest';
import {
	TrackLayoutState,
	defaultTrackConfigs,
	defaultGroupCollapsed,
	applyPersisted,
	clampHeight,
	layoutStorageKey,
	COLLAPSED_TRACK_HEIGHT,
	GROUP_HEADER_HEIGHT,
	type TrackId,
} from './tracks.svelte';

class MemoryStorage implements Storage {
	#m = new Map<string, string>();
	get length() {
		return this.#m.size;
	}
	clear() {
		this.#m.clear();
	}
	getItem(k: string) {
		return this.#m.has(k) ? this.#m.get(k)! : null;
	}
	key(i: number) {
		return [...this.#m.keys()][i] ?? null;
	}
	removeItem(k: string) {
		this.#m.delete(k);
	}
	setItem(k: string, v: string) {
		this.#m.set(k, v);
	}
}

class ThrowingStorage extends MemoryStorage {
	getItem(): string | null {
		throw new Error('blocked');
	}
	setItem(): void {
		throw new Error('quota');
	}
	removeItem(): void {
		throw new Error('blocked');
	}
}

const heights = (mode: 'view' | 'edit' | 'task') =>
	Object.fromEntries(defaultTrackConfigs(mode).map((t) => [t.id, t.height])) as Record<TrackId, number>;

const ids = (layout: TrackLayoutState, group: 'audio' | 'face' | 'annotations') =>
	layout.grouped.find((g) => g.id === group)!.tracks.map((t) => t.id);

describe('defaultTrackConfigs', () => {
	it('uses the design view/edit heights', () => {
		expect(heights('view')).toMatchObject({
			waveform: 112,
			vad: 40,
			diarization: 28,
			mouth_energy: 44,
			head_pose: 72,
			transcription: 44,
			states: 32,
			intents: 48,
			user_labels: 32,
		});
		expect(heights('edit')).toEqual(heights('view'));
	});

	it('uses the design task heights', () => {
		expect(heights('task')).toMatchObject({ waveform: 88, vad: 32, diarization: 28, transcription: 48, intents: 72 });
	});

	it('groups tracks and numbers order within each group', () => {
		const cfg = defaultTrackConfigs('view');
		expect(cfg.filter((t) => t.group === 'audio').map((t) => [t.id, t.order])).toEqual([
			['waveform', 0],
			['vad', 1],
			['diarization', 2],
		]);
		expect(cfg.filter((t) => t.group === 'face').map((t) => t.id)).toEqual(['mouth_energy', 'head_pose']);
		expect(cfg.find((t) => t.id === 'intents')).toMatchObject({ kind: 'editable', editableType: 'intents' });
		expect(cfg.find((t) => t.id === 'user_labels')).toMatchObject({ editableType: 'userLabels' });
		expect(cfg.find((t) => t.id === 'waveform')).toMatchObject({ kind: 'canvas' });
		expect(cfg.find((t) => t.id === 'waveform')!.editableType).toBeUndefined();
	});

	it('collapses nothing outside task mode', () => {
		expect(defaultTrackConfigs('edit').some((t) => t.collapsed)).toBe(false);
		expect(defaultGroupCollapsed('edit')).toEqual({ audio: false, face: false, annotations: false });
	});

	it('task mode collapses Face and non-editable annotation tracks, keeping transcription open', () => {
		const cfg = defaultTrackConfigs('task', { editableTypes: ['intents'] });
		const collapsed = cfg.filter((t) => t.collapsed).map((t) => t.id);
		expect(collapsed).toEqual(['states', 'backchannels', 'user_labels']);
		expect(defaultGroupCollapsed('task')).toEqual({ audio: false, face: true, annotations: false });
	});

	it('every default height sits inside its bounds', () => {
		for (const mode of ['view', 'task'] as const) {
			for (const t of defaultTrackConfigs(mode)) {
				expect(t.height).toBeGreaterThanOrEqual(t.minHeight);
				expect(t.height).toBeLessThanOrEqual(t.maxHeight);
			}
		}
	});
});

describe('clampHeight', () => {
	const t = { minHeight: 20, maxHeight: 100 };
	it('clamps and rounds', () => {
		expect(clampHeight(t, 5)).toBe(20);
		expect(clampHeight(t, 500)).toBe(100);
		expect(clampHeight(t, 55.6)).toBe(56);
		expect(clampHeight(t, Number.NaN)).toBe(20);
	});
});

describe('applyPersisted', () => {
	const tracks = defaultTrackConfigs('view');
	const groups = defaultGroupCollapsed('view');

	it('ignores missing, malformed or wrong-version data', () => {
		expect(applyPersisted(tracks, groups, null).tracks).toBe(tracks);
		expect(applyPersisted(tracks, groups, 'x').tracks).toBe(tracks);
		expect(applyPersisted(tracks, groups, { v: 999, tracks: {}, groups: {} }).tracks).toBe(tracks);
	});

	it('overlays values, clamps heights and ignores unknown ids', () => {
		const out = applyPersisted(tracks, groups, {
			v: 1,
			tracks: { vad: { height: 9999, collapsed: true }, nope: { height: 10 }, waveform: { height: 'big' } },
			groups: { face: true, audio: 'yes' },
		});
		const vad = out.tracks.find((t) => t.id === 'vad')!;
		expect(vad.height).toBe(vad.maxHeight);
		expect(vad.collapsed).toBe(true);
		expect(out.tracks.find((t) => t.id === 'waveform')!.height).toBe(112);
		expect(out.groups).toEqual({ audio: false, face: true, annotations: false });
	});

	it('renormalises order', () => {
		const out = applyPersisted(tracks, groups, {
			v: 1,
			tracks: { waveform: { order: 10 }, vad: { order: -3 } },
			groups: {},
		});
		expect(out.tracks.filter((t) => t.group === 'audio').map((t) => [t.id, t.order])).toEqual([
			['vad', 0],
			['diarization', 1],
			['waveform', 2],
		]);
	});
});

describe('TrackLayoutState', () => {
	let storage: MemoryStorage;
	beforeEach(() => {
		storage = new MemoryStorage();
	});

	const make = (opts: ConstructorParameters<typeof TrackLayoutState>[0] = {}) =>
		new TrackLayoutState({ userId: 'u1', storage, ...opts });

	it('starts from mode defaults', () => {
		const layout = make({ mode: 'task', editableTypes: ['intents'] });
		expect(layout.mode).toBe('task');
		expect(layout.get('intents')!.height).toBe(72);
		expect(layout.groupCollapsed.face).toBe(true);
		expect(layout.get('states')!.collapsed).toBe(true);
	});

	describe('toggleCollapse', () => {
		it('toggles a track', () => {
			const layout = make();
			expect(layout.toggleCollapse('vad')).toBe(true);
			expect(layout.get('vad')!.collapsed).toBe(true);
			expect(layout.renderHeight('vad')).toBe(COLLAPSED_TRACK_HEIGHT);
			expect(layout.toggleCollapse('vad')).toBe(false);
			expect(layout.renderHeight('vad')).toBe(40);
		});

		it('toggles a group', () => {
			const layout = make();
			expect(layout.toggleCollapse('face')).toBe(true);
			expect(layout.groupCollapsed.face).toBe(true);
			const face = layout.visibleTracks.find((g) => g.id === 'face')!;
			expect(face.collapsed).toBe(true);
			expect(face.tracks).toEqual([]);
		});
	});

	describe('setHeight', () => {
		it('clamps to bounds and returns the applied height', () => {
			const layout = make();
			expect(layout.setHeight('intents', 64)).toBe(64);
			expect(layout.get('intents')!.height).toBe(64);
			expect(layout.setHeight('intents', 2)).toBe(layout.get('intents')!.minHeight);
			expect(layout.setHeight('intents', 5000)).toBe(layout.get('intents')!.maxHeight);
		});

		it('returns 0 for unknown ids', () => {
			expect(make().setHeight('nope' as TrackId, 50)).toBe(0);
		});
	});

	describe('move', () => {
		it('moves within the group and stops at edges', () => {
			const layout = make();
			expect(layout.move('vad', -1)).toBe(true);
			expect(ids(layout, 'audio')).toEqual(['vad', 'waveform', 'diarization']);
			expect(layout.move('vad', -1)).toBe(false);
			expect(layout.move('vad', 5)).toBe(true);
			expect(ids(layout, 'audio')).toEqual(['waveform', 'diarization', 'vad']);
			expect(layout.move('vad', 1)).toBe(false);
			expect(layout.move('vad', 0)).toBe(false);
		});

		it('steps over tracks that are not available', () => {
			const layout = make();
			layout.available = new Set<TrackId>(['transcription', 'states', 'intents', 'user_labels']);
			// backchannels (hidden) sits between intents and user_labels
			expect(layout.move('user_labels', -1)).toBe(true);
			expect(ids(layout, 'annotations').filter((id) => id !== 'backchannels')).toEqual([
				'transcription',
				'states',
				'user_labels',
				'intents',
			]);
			expect(layout.move('transcription', -1)).toBe(false);
		});

		it('keeps orders contiguous and leaves other groups alone', () => {
			const layout = make();
			const before = ids(layout, 'annotations');
			layout.move('diarization', -2);
			expect(layout.tracks.filter((t) => t.group === 'audio').map((t) => t.order).sort()).toEqual([0, 1, 2]);
			expect(ids(layout, 'annotations')).toEqual(before);
		});
	});

	describe('reorder', () => {
		it('drops a track at the target position', () => {
			const layout = make();
			expect(layout.reorder('user_labels', 'transcription')).toBe(true);
			expect(ids(layout, 'annotations')).toEqual(['user_labels', 'transcription', 'states', 'intents', 'backchannels']);
			expect(layout.reorder('transcription', 'backchannels')).toBe(true);
			expect(ids(layout, 'annotations')).toEqual(['user_labels', 'states', 'intents', 'backchannels', 'transcription']);
		});

		it('refuses cross-group, self and unknown targets', () => {
			const layout = make();
			expect(layout.reorder('vad', 'intents')).toBe(false);
			expect(layout.reorder('vad', 'vad')).toBe(false);
			expect(layout.reorder('vad', 'nope' as TrackId)).toBe(false);
		});
	});

	describe('visibleTracks', () => {
		it('lists groups in order with ordered tracks', () => {
			const layout = make();
			expect(layout.visibleTracks.map((g) => [g.id, g.label])).toEqual([
				['audio', 'Audio'],
				['face', 'Face'],
				['annotations', 'Annotations'],
			]);
			layout.move('diarization', -2);
			expect(layout.visibleTracks[0].tracks.map((t) => t.id)).toEqual(['diarization', 'waveform', 'vad']);
		});

		it('filters by availability and drops empty groups', () => {
			const layout = make();
			layout.available = new Set<TrackId>(['waveform', 'intents']);
			expect(layout.visibleTracks.map((g) => g.id)).toEqual(['audio', 'annotations']);
			expect(layout.visibleTrackList.map((t) => t.id)).toEqual(['waveform', 'intents']);
		});

		it('computes the total rendered height', () => {
			const layout = make();
			layout.available = new Set<TrackId>(['waveform', 'vad', 'mouth_energy']);
			layout.toggleCollapse('vad');
			layout.toggleCollapse('face');
			expect(layout.totalHeight).toBe(GROUP_HEADER_HEIGHT * 2 + 112 + COLLAPSED_TRACK_HEIGHT);
		});
	});

	describe('persistence', () => {
		it('persists per user and mode', () => {
			const a = make();
			a.setHeight('waveform', 150);
			a.toggleCollapse('face');
			a.move('vad', -1);

			const b = make();
			expect(b.get('waveform')!.height).toBe(150);
			expect(b.groupCollapsed.face).toBe(true);
			expect(ids(b, 'audio')[0]).toBe('vad');

			expect(make({ userId: 'u2' }).get('waveform')!.height).toBe(112);
			expect(make({ mode: 'task' }).get('waveform')!.height).toBe(88);
			expect(storage.getItem(layoutStorageKey('u1', 'view'))).not.toBeNull();
		});

		it('setMode loads that mode', () => {
			const layout = make();
			layout.setHeight('intents', 100);
			layout.setMode('task', { editableTypes: ['intents'] });
			expect(layout.mode).toBe('task');
			expect(layout.get('intents')!.height).toBe(72);
			layout.setMode('view');
			expect(layout.get('intents')!.height).toBe(100);
		});

		it('view and edit share one layout (⌘E keeps heights and collapse)', () => {
			const layout = make();
			layout.setHeight('intents', 100);
			layout.toggleCollapse('vad');
			layout.setMode('edit');
			expect(layout.mode).toBe('edit');
			expect(layout.get('intents')!.height).toBe(100);
			expect(layout.get('vad')!.collapsed).toBe(true);
			layout.setHeight('intents', 120);
			layout.setMode('view');
			expect(layout.get('intents')!.height).toBe(120);
			expect(layoutStorageKey('u1', 'view')).toBe(layoutStorageKey('u1', 'edit'));
			expect(layoutStorageKey('u1', 'task')).not.toBe(layoutStorageKey('u1', 'view'));
		});

		it('setUser reloads under the new key', () => {
			const layout = make({ userId: null });
			layout.setHeight('vad', 80);
			expect(storage.getItem(layoutStorageKey(null, 'view'))).not.toBeNull();
			layout.setUser('u9');
			expect(layout.get('vad')!.height).toBe(40);
		});

		it('reset restores defaults and clears storage', () => {
			const layout = make();
			layout.setHeight('vad', 80);
			layout.reset();
			expect(layout.get('vad')!.height).toBe(40);
			expect(storage.getItem(layoutStorageKey('u1', 'view'))).toBeNull();
		});

		it('survives corrupt JSON', () => {
			storage.setItem(layoutStorageKey('u1', 'view'), '{not json');
			expect(make().get('waveform')!.height).toBe(112);
		});

		it('works with throwing or missing storage', () => {
			const t = new TrackLayoutState({ userId: 'u1', storage: new ThrowingStorage() });
			expect(t.setHeight('vad', 60)).toBe(60);
			expect(t.toggleCollapse('audio')).toBe(true);
			expect(() => t.reset()).not.toThrow();

			const none = new TrackLayoutState({ storage: null });
			expect(none.move('vad', 1)).toBe(true);
		});
	});
});
