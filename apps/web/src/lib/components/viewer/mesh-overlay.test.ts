import { describe, it, expect } from 'vitest';
import { findNearestFrame, interpolateDepth } from './mesh-overlay.js';
import type { FacialTrackingFrame, MeshKeyframe } from '@annotation/shared';

// Minimal FacialTrackingFrame builder — only `time` matters for findNearestFrame.
const frame = (time: number): FacialTrackingFrame => ({
	time,
	facial_tracking: {
		tracking: {
			blendshapes: [],
			head_pose: { rotation: [0, 0, 0], translation: [0, 0, 0] },
			gaze_direction: [0, 0, 0],
			landmarks: [],
			confidence: 1,
			face_detected: true,
		},
	},
});

const keyframe = (time: number, depth: number[]): MeshKeyframe => ({
	time,
	vertices: [],
	depth,
	face_detected: true,
});

describe('findNearestFrame', () => {
	it('returns null for empty data', () => {
		expect(findNearestFrame([], 5)).toBeNull();
	});

	it('returns the only frame for a single-item array regardless of time', () => {
		const only = frame(10);
		expect(findNearestFrame([only], -5)).toBe(only);
		expect(findNearestFrame([only], 10)).toBe(only);
		expect(findNearestFrame([only], 500)).toBe(only);
	});

	it('returns the exact frame on an exact time hit', () => {
		const frames = [frame(0), frame(1), frame(2), frame(3)];
		expect(findNearestFrame(frames, 2)).toBe(frames[2]);
	});

	it('clamps to the first frame when time is before the first frame', () => {
		const frames = [frame(1), frame(2), frame(3)];
		expect(findNearestFrame(frames, -10)).toBe(frames[0]);
	});

	it('clamps to the last frame when time is after the last frame', () => {
		const frames = [frame(1), frame(2), frame(3)];
		expect(findNearestFrame(frames, 100)).toBe(frames[2]);
	});

	it('picks the closer of two bracketing frames', () => {
		const frames = [frame(0), frame(10)];
		expect(findNearestFrame(frames, 3)).toBe(frames[0]);
		expect(findNearestFrame(frames, 7)).toBe(frames[1]);
	});

	it('prefers the earlier (previous) frame on an exact tie', () => {
		const frames = [frame(0), frame(10)];
		// time=5 is equidistant from both; implementation uses <= so prev wins the tie.
		expect(findNearestFrame(frames, 5)).toBe(frames[0]);
	});

	it('does not mutate the input array', () => {
		const frames = [frame(0), frame(1), frame(2)];
		const original = structuredClone(frames);

		findNearestFrame(frames, 1.4);

		expect(frames).toEqual(original);
	});
});

describe('interpolateDepth', () => {
	it('returns null when keyframes is undefined', () => {
		expect(interpolateDepth(undefined, 5)).toBeNull();
	});

	it('returns null for an empty keyframes array', () => {
		expect(interpolateDepth([], 5)).toBeNull();
	});

	it('returns the only keyframe depth for a single-item array regardless of time', () => {
		const kf = keyframe(5, [1, 2, 3]);
		expect(interpolateDepth([kf], -100)).toEqual([1, 2, 3]);
		expect(interpolateDepth([kf], 5)).toEqual([1, 2, 3]);
		expect(interpolateDepth([kf], 100)).toEqual([1, 2, 3]);
	});

	it('clamps to the first keyframe depth when time is before the first keyframe', () => {
		const keyframes = [keyframe(1, [1, 1]), keyframe(2, [2, 2])];
		expect(interpolateDepth(keyframes, 0)).toEqual([1, 1]);
	});

	it('clamps to the last keyframe depth when time is after the last keyframe', () => {
		const keyframes = [keyframe(1, [1, 1]), keyframe(2, [2, 2])];
		expect(interpolateDepth(keyframes, 100)).toEqual([2, 2]);
	});

	it('returns the exact keyframe depth on an exact hit at the first keyframe', () => {
		const keyframes = [keyframe(1, [1, 1]), keyframe(2, [2, 2]), keyframe(3, [3, 3])];
		expect(interpolateDepth(keyframes, 1)).toEqual([1, 1]);
	});

	it('returns the exact keyframe depth on an exact hit at a middle keyframe', () => {
		const keyframes = [keyframe(1, [1, 1]), keyframe(2, [2, 2]), keyframe(3, [3, 3])];
		expect(interpolateDepth(keyframes, 2)).toEqual([2, 2]);
	});

	it('returns the exact keyframe depth on an exact hit at the last keyframe', () => {
		const keyframes = [keyframe(1, [1, 1]), keyframe(2, [2, 2]), keyframe(3, [3, 3])];
		expect(interpolateDepth(keyframes, 3)).toEqual([3, 3]);
	});

	it('linearly interpolates depth values at the midpoint between two keyframes', () => {
		const keyframes = [keyframe(0, [0, 10]), keyframe(10, [10, 0])];
		expect(interpolateDepth(keyframes, 5)).toEqual([5, 5]);
	});

	it('linearly interpolates depth values off-center', () => {
		const keyframes = [keyframe(0, [0]), keyframe(10, [100])];
		// t = 0.25 -> 0 + 0.25 * (100 - 0) = 25
		expect(interpolateDepth(keyframes, 2.5)).toEqual([25]);
	});

	it('selects the correct bracketing pair among several keyframes', () => {
		const keyframes = [
			keyframe(0, [0]),
			keyframe(10, [100]),
			keyframe(20, [200]),
			keyframe(30, [300]),
		];
		// time=15 should interpolate between the 10 and 20 keyframes, not 0/10 or 20/30.
		expect(interpolateDepth(keyframes, 15)).toEqual([150]);
	});

	it('does not mutate the input keyframes array', () => {
		const keyframes = [keyframe(0, [0, 10]), keyframe(10, [10, 0])];
		const original = structuredClone(keyframes);

		interpolateDepth(keyframes, 5);

		expect(keyframes).toEqual(original);
	});

	it('returns a new array, not a reference into a keyframe depth array', () => {
		const kf0 = keyframe(0, [0]);
		const kf1 = keyframe(10, [10]);
		const result = interpolateDepth([kf0, kf1], 5);

		expect(result).not.toBe(kf0.depth);
		expect(result).not.toBe(kf1.depth);
	});
});
