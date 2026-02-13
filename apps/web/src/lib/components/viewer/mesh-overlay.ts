import type { FacialTrackingFrame, MeshKeyframe, MeshTopology } from '@annotation/shared';
import type { ViewerPalette } from './viewer-palette.js';

/**
 * Binary search for the nearest frame by time.
 * Returns null if data is empty.
 */
export function findNearestFrame(
	data: FacialTrackingFrame[],
	time: number,
): FacialTrackingFrame | null {
	if (data.length === 0) return null;

	let lo = 0;
	let hi = data.length - 1;

	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (data[mid].time < time) lo = mid + 1;
		else hi = mid;
	}

	// lo is now the first frame with time >= target.
	// Check whether lo or lo-1 is closer.
	if (lo > 0) {
		const prev = data[lo - 1];
		const curr = data[lo];
		if (Math.abs(prev.time - time) <= Math.abs(curr.time - time)) {
			return prev;
		}
	}
	return data[lo];
}

/**
 * Binary search two bracketing keyframes and lerp 478 depth values.
 * Clamps to nearest keyframe when time is outside range.
 */
export function interpolateDepth(
	keyframes: MeshKeyframe[] | undefined,
	time: number,
): number[] | null {
	if (!keyframes || keyframes.length === 0) return null;

	// Before first keyframe — clamp
	if (time <= keyframes[0].time) return keyframes[0].depth;

	// After last keyframe — clamp
	const last = keyframes[keyframes.length - 1];
	if (time >= last.time) return last.depth;

	// Binary search for the first keyframe with time >= target
	let lo = 0;
	let hi = keyframes.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (keyframes[mid].time < time) lo = mid + 1;
		else hi = mid;
	}

	const next = keyframes[lo];
	const prev = keyframes[lo - 1];
	const t = (time - prev.time) / (next.time - prev.time);

	const result = new Array<number>(prev.depth.length);
	for (let i = 0; i < result.length; i++) {
		result[i] = prev.depth[i] + t * (next.depth[i] - prev.depth[i]);
	}
	return result;
}

/**
 * Draw the face mesh wireframe onto a 2D canvas context.
 * Uses depth-bucketed coloring when depth data is available,
 * falls back to flat wireframe color otherwise.
 */
export function drawMeshWireframe(
	ctx: CanvasRenderingContext2D,
	landmarks: [number, number, number][],
	depth: number[] | null,
	topology: MeshTopology,
	palette: ViewerPalette,
): void {
	const { tessellation, contours, irises } = topology;

	if (depth) {
		// Min-max normalize depth
		let dMin = Infinity;
		let dMax = -Infinity;
		for (let i = 0; i < depth.length; i++) {
			if (depth[i] < dMin) dMin = depth[i];
			if (depth[i] > dMax) dMax = depth[i];
		}
		const range = dMax - dMin || 1;

		// Group tessellation edges into 8 depth buckets
		const buckets: [number, number][][] = Array.from({ length: 8 }, () => []);
		for (const edge of tessellation) {
			const avgDepth = (depth[edge[0]] + depth[edge[1]]) / 2;
			const normalized = (avgDepth - dMin) / range;
			const bucket = Math.min(7, Math.floor(normalized * 8));
			buckets[bucket].push(edge);
		}

		// Draw each bucket with its depth color
		ctx.lineWidth = 1.5;
		for (let b = 0; b < 8; b++) {
			if (buckets[b].length === 0) continue;
			ctx.strokeStyle = palette.meshDepth[b];
			ctx.beginPath();
			for (const [i, j] of buckets[b]) {
				ctx.moveTo(landmarks[i][0], landmarks[i][1]);
				ctx.lineTo(landmarks[j][0], landmarks[j][1]);
			}
			ctx.stroke();
		}
	} else {
		// Flat wireframe fallback
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = palette.meshWireframe;
		ctx.beginPath();
		for (const [i, j] of tessellation) {
			ctx.moveTo(landmarks[i][0], landmarks[i][1]);
			ctx.lineTo(landmarks[j][0], landmarks[j][1]);
		}
		ctx.stroke();
	}

	// Contour edges — slightly thicker
	ctx.lineWidth = 2.0;
	ctx.strokeStyle = palette.meshWireframe;
	ctx.beginPath();
	for (const [i, j] of contours) {
		ctx.moveTo(landmarks[i][0], landmarks[i][1]);
		ctx.lineTo(landmarks[j][0], landmarks[j][1]);
	}
	ctx.stroke();

	// Iris edges
	ctx.lineWidth = 2.0;
	ctx.strokeStyle = palette.meshIris;
	ctx.beginPath();
	for (const [i, j] of irises) {
		ctx.moveTo(landmarks[i][0], landmarks[i][1]);
		ctx.lineTo(landmarks[j][0], landmarks[j][1]);
	}
	ctx.stroke();
}
