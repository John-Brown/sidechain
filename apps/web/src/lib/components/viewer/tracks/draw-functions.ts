import { binarySearchStart, binarySearchEnd } from '../utils/binary-search.js';
import type { Viewport } from '../types.js';
import type { VadFrame, DiarizationSegment, MouthEnergySegment, FacialTrackingFrame } from '@annotation/shared';

function timeToPx(time: number, zoom: number): number {
	return time * zoom;
}

/**
 * Compute the visible time range for viewport culling.
 * Canvas is full timeline width (absolute positions).
 * Visible portion is [scrollLeft, scrollLeft + containerWidth].
 */
function viewBounds(viewport: Viewport): { viewStart: number; viewEnd: number } {
	const { scrollLeft, zoom, containerWidth } = viewport;
	return {
		viewStart: scrollLeft / zoom,
		viewEnd: (scrollLeft + containerWidth) / zoom,
	};
}

export function drawRuler(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport
): void {
	const { scrollLeft, zoom, duration, containerWidth } = viewport;

	let tickInterval: number;
	if (zoom < 2) tickInterval = 10;
	else if (zoom < 5) tickInterval = 5;
	else if (zoom < 15) tickInterval = 2;
	else tickInterval = 1;

	const majorEvery = 5;

	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	ctx.font = '9px monospace';

	for (let t = 0; t <= duration; t += tickInterval) {
		const x = timeToPx(t, zoom);
		// Cull: only draw ticks visible in viewport
		if (x < scrollLeft - 10 || x > scrollLeft + containerWidth + 10) continue;

		const tickIndex = Math.round(t / tickInterval);
		const isMajor = tickIndex % majorEvery === 0;

		if (isMajor) {
			ctx.strokeStyle = '#4a5068';
			ctx.beginPath();
			ctx.moveTo(x, height);
			ctx.lineTo(x, height - 16);
			ctx.stroke();

			const minutes = Math.floor(t / 60);
			const seconds = Math.floor(t % 60);
			const label = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
			ctx.fillStyle = '#8b90a0';
			ctx.fillText(label, x, 2);
		} else {
			ctx.strokeStyle = '#2e3345';
			ctx.beginPath();
			ctx.moveTo(x, height);
			ctx.lineTo(x, height - 8);
			ctx.stroke();
		}
	}
}

export function drawVad(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	data: VadFrame[]
): void {
	if (!data || data.length === 0) return;

	const { zoom } = viewport;
	const { viewStart, viewEnd } = viewBounds(viewport);

	const startIdx = binarySearchStart(data, viewStart);
	const endIdx = binarySearchEnd(data, viewEnd);

	ctx.fillStyle = 'rgba(99, 102, 241, 0.6)';
	for (let i = startIdx; i <= endIdx && i < data.length; i++) {
		const frame = data[i];
		const x = timeToPx(frame.time_range.start, zoom);
		const w = Math.max(timeToPx(frame.time_range.end - frame.time_range.start, zoom), 1);
		const h = frame.speech_probability * (height - 4);
		ctx.fillRect(x, height - h - 2, w, h);
	}

	// Threshold line at 0.5
	const thresholdY = height - 0.5 * (height - 4) - 2;
	ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
	ctx.setLineDash([3, 3]);
	ctx.beginPath();
	ctx.moveTo(0, thresholdY);
	ctx.lineTo(width, thresholdY);
	ctx.stroke();
	ctx.setLineDash([]);
}

const SPEAKER_COLORS: Record<string, { bg: string; border: string }> = {
	SPEAKER_00: { bg: 'rgba(34, 211, 238, 0.3)', border: 'rgba(34, 211, 238, 0.6)' },
	SPEAKER_01: { bg: 'rgba(244, 114, 182, 0.3)', border: 'rgba(244, 114, 182, 0.6)' }
};
const DEFAULT_SPEAKER_COLOR = { bg: 'rgba(100, 116, 139, 0.2)', border: 'rgba(100, 116, 139, 0.4)' };

export function drawDiarization(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	data: DiarizationSegment[]
): void {
	if (!data || data.length === 0) return;

	const { scrollLeft, zoom, containerWidth } = viewport;

	ctx.font = '9px monospace';
	ctx.textBaseline = 'middle';

	for (const seg of data) {
		const x = timeToPx(seg.time_range.start, zoom);
		const w = timeToPx(seg.time_range.end - seg.time_range.start, zoom);

		if (x + w < scrollLeft || x > scrollLeft + containerWidth) continue;

		const speaker = seg.diarization.speaker;
		const colors = SPEAKER_COLORS[speaker] ?? DEFAULT_SPEAKER_COLOR;

		ctx.fillStyle = colors.bg;
		ctx.fillRect(x, 4, w, height - 8);
		ctx.strokeStyle = colors.border;
		ctx.strokeRect(x, 4, w, height - 8);

		if (w > 40) {
			const label = speaker.replace('SPEAKER_0', 'S');
			ctx.fillStyle = colors.border;
			ctx.fillText(label, x + 6, height / 2);
		}
	}
}

export function drawWaveform(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	peaksL: Float32Array,
	peaksR: Float32Array | null,
	peaksSampleRate: number
): void {
	if (!peaksL || peaksL.length === 0) return;

	const { scrollLeft, zoom, containerWidth } = viewport;
	// Only draw the visible pixel range
	const pxStart = Math.max(0, Math.floor(scrollLeft));
	const pxEnd = Math.min(width, Math.ceil(scrollLeft + containerWidth));

	if (peaksR) {
		// Stereo: top half = left, bottom half = right
		const halfH = height / 2;

		// Left channel (top)
		ctx.fillStyle = 'rgba(34, 211, 238, 0.5)';
		drawChannelBars(ctx, peaksL, peaksSampleRate, zoom, pxStart, pxEnd, 0, halfH, false);

		// Right channel (bottom)
		ctx.fillStyle = 'rgba(244, 114, 182, 0.5)';
		drawChannelBars(ctx, peaksR, peaksSampleRate, zoom, pxStart, pxEnd, halfH, halfH, true);

		// Center line
		ctx.strokeStyle = '#2e3345';
		ctx.beginPath();
		ctx.moveTo(pxStart, halfH);
		ctx.lineTo(pxEnd, halfH);
		ctx.stroke();
	} else {
		// Mono: mirrored around center
		const centerY = height / 2;
		ctx.fillStyle = 'rgba(99, 102, 241, 0.5)';

		for (let px = pxStart; px < pxEnd; px++) {
			const time = px / zoom;
			const sampleIdx = Math.floor(time * peaksSampleRate);
			if (sampleIdx < 0 || sampleIdx >= peaksL.length) continue;

			const peak = peaksL[sampleIdx];
			const barH = peak * (centerY - 2);
			ctx.fillRect(px, centerY - barH, 1, barH * 2);
		}

		// Center line
		ctx.strokeStyle = 'rgba(46, 51, 69, 0.5)';
		ctx.beginPath();
		ctx.moveTo(pxStart, centerY);
		ctx.lineTo(pxEnd, centerY);
		ctx.stroke();
	}
}

function drawChannelBars(
	ctx: CanvasRenderingContext2D,
	peaks: Float32Array,
	peaksSampleRate: number,
	zoom: number,
	pxStart: number,
	pxEnd: number,
	yOffset: number,
	halfH: number,
	fromTop: boolean
): void {
	for (let px = pxStart; px < pxEnd; px++) {
		const time = px / zoom;
		const sampleIdx = Math.floor(time * peaksSampleRate);
		if (sampleIdx < 0 || sampleIdx >= peaks.length) continue;

		const peak = peaks[sampleIdx];
		const barH = peak * (halfH - 2);
		if (fromTop) {
			ctx.fillRect(px, yOffset, 1, barH);
		} else {
			ctx.fillRect(px, yOffset + halfH - barH, 1, barH);
		}
	}
}

export function drawMouthEnergy(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	data: MouthEnergySegment[]
): void {
	if (!data || data.length === 0) return;

	const { zoom } = viewport;
	const { viewStart, viewEnd } = viewBounds(viewport);

	const startIdx = binarySearchStart(data, viewStart);
	const endIdx = binarySearchEnd(data, viewEnd);

	if (startIdx > endIdx) return;

	ctx.strokeStyle = 'rgba(52, 211, 153, 0.8)';
	ctx.lineWidth = 1.5;
	ctx.beginPath();

	let started = false;
	for (let i = startIdx; i <= endIdx && i < data.length; i++) {
		const seg = data[i];
		const midpoint = (seg.time_range.start + seg.time_range.end) / 2;
		const x = timeToPx(midpoint, zoom);
		const y = height - (seg.mouth_energy.mouth_energy * (height - 8)) - 4;

		if (!started) {
			ctx.moveTo(x, y);
			started = true;
		} else {
			ctx.lineTo(x, y);
		}
	}

	ctx.stroke();
}

// --- Head Pose (from facial tracking) ---

const HEAD_POSE_COLORS = {
	pitch: 'rgba(245, 158, 11, 0.8)',  // amber — nod
	yaw: 'rgba(99, 102, 241, 0.8)',    // indigo — turn
	roll: 'rgba(52, 211, 153, 0.8)',    // emerald — tilt
};

// Head pose angles are roughly ±60°. Normalize to 0-1 range for drawing.
const POSE_RANGE = 60; // degrees

function normalizePose(degrees: number): number {
	return Math.max(0, Math.min(1, (degrees + POSE_RANGE) / (POSE_RANGE * 2)));
}

export function drawHeadPose(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	data: FacialTrackingFrame[]
): void {
	if (!data || data.length === 0) return;

	const { scrollLeft, zoom, containerWidth } = viewport;
	const viewStart = scrollLeft / zoom;
	const viewEnd = (scrollLeft + containerWidth) / zoom;

	// Binary search for viewport culling — FacialTrackingFrame has `time` not `time_range`
	let startIdx = 0;
	let endIdx = data.length - 1;
	// Find first frame with time >= viewStart
	{
		let lo = 0, hi = data.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (data[mid].time < viewStart) lo = mid + 1;
			else hi = mid - 1;
		}
		startIdx = Math.max(0, lo - 1); // include one before for line continuity
	}
	// Find last frame with time <= viewEnd
	{
		let lo = 0, hi = data.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (data[mid].time <= viewEnd) lo = mid + 1;
			else hi = mid - 1;
		}
		endIdx = Math.min(data.length - 1, lo);
	}

	if (startIdx > endIdx) return;

	// Center line (0° = center)
	const centerY = height / 2;
	ctx.strokeStyle = 'rgba(46, 51, 69, 0.3)';
	ctx.setLineDash([2, 4]);
	ctx.beginPath();
	ctx.moveTo(Math.max(0, scrollLeft), centerY);
	ctx.lineTo(Math.min(width, scrollLeft + containerWidth), centerY);
	ctx.stroke();
	ctx.setLineDash([]);

	// Draw each axis as a line
	const axes: Array<{ colorKey: keyof typeof HEAD_POSE_COLORS; axisIdx: number }> = [
		{ colorKey: 'pitch', axisIdx: 0 },
		{ colorKey: 'yaw', axisIdx: 1 },
		{ colorKey: 'roll', axisIdx: 2 },
	];

	for (const { colorKey, axisIdx } of axes) {
		ctx.strokeStyle = HEAD_POSE_COLORS[colorKey];
		ctx.lineWidth = 1.2;
		ctx.beginPath();

		let started = false;
		for (let i = startIdx; i <= endIdx && i < data.length; i++) {
			const frame = data[i];
			if (!frame.facial_tracking.tracking.face_detected) continue;

			const x = timeToPx(frame.time, zoom);
			const angle = frame.facial_tracking.tracking.head_pose.rotation[axisIdx];
			const y = height - normalizePose(angle) * (height - 8) - 4;

			if (!started) {
				ctx.moveTo(x, y);
				started = true;
			} else {
				ctx.lineTo(x, y);
			}
		}

		ctx.stroke();
	}
}
