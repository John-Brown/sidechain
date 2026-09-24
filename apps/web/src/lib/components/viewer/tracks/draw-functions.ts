import { binarySearchStart, binarySearchEnd } from '../utils/binary-search.js';
import type { Viewport } from '../types.js';
import type { VadFrame, DiarizationSegment, MouthEnergySegment, FacialTrackingFrame } from '@annotation/shared';
import type { ViewerPalette } from '../viewer-palette.js';

/** Canvas font for ruler timecodes (numbers are mono, per the style guide). */
export const RULER_FONT = '10px "IBM Plex Mono", monospace';
/** Canvas font for in-canvas text labels. */
export const CANVAS_LABEL_FONT = '10px "DM Sans Variable", sans-serif';
/** Canvas font for short mono tags drawn on data (e.g. diarization "S0"). */
export const CANVAS_TAG_FONT = '10px "IBM Plex Mono", monospace';

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

/** Candidate ruler steps in seconds (fine to coarse). */
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function isMultiple(a: number, b: number): boolean {
	const r = a / b;
	return Math.abs(r - Math.round(r)) < 1e-6;
}

/**
 * Pick ruler tick spacing for a zoom (px/s). At the design's 72 px/s this is
 * 0.5 s minor ticks, 1 s ticks, 5 s majors and a label every 2 s.
 */
export function rulerSteps(zoom: number): { minor: number; mid: number; major: number; label: number } {
	const pick = (minPx: number, multipleOf: number, after = 0) =>
		RULER_STEPS.find((s) => s > after && s * zoom >= minPx && isMultiple(s, multipleOf)) ??
		RULER_STEPS[RULER_STEPS.length - 1];
	const minor = pick(24, RULER_STEPS[0]);
	const mid = pick(0, minor, minor);
	const major = RULER_STEPS.find((s) => s >= mid * 5 && isMultiple(s, mid)) ?? mid * 5;
	const label = pick(100, mid);
	return { minor, mid, major, label };
}

/**
 * Time ruler (timeline-screen.html): minor ticks 4px, whole ticks 7px and
 * major ticks 12px from the bottom edge, MM:SS labels in mono at the top.
 */
export function drawRuler(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	palette: ViewerPalette
): void {
	const { zoom, duration } = viewport;
	const { viewStart, viewEnd } = viewBounds(viewport);
	const { minor, mid, major, label } = rulerSteps(zoom);

	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	ctx.font = RULER_FONT;
	ctx.lineWidth = 1;

	const first = Math.max(0, Math.floor((viewStart - 1) / minor) * minor);
	const last = Math.min(duration, viewEnd + 1);
	for (let i = Math.round(first / minor); i * minor <= last; i++) {
		const t = i * minor;
		// Half-pixel offset keeps 1px ticks crisp
		const x = Math.round(timeToPx(t, zoom)) + 0.5;
		const isMajor = isMultiple(t, major);
		const isMid = isMultiple(t, mid);
		const tickH = isMajor ? 12 : isMid ? 7 : 4;

		ctx.strokeStyle = isMajor ? palette.gridMajor : palette.gridMinor;
		ctx.beginPath();
		ctx.moveTo(x, height);
		ctx.lineTo(x, height - tickH);
		ctx.stroke();

		if (isMultiple(t, label)) {
			const minutes = Math.floor(t / 60);
			const seconds = Math.floor(t % 60);
			const text = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
			ctx.fillStyle = palette.rulerLabel;
			ctx.fillText(text, x, 3);
		}
	}
}

export function drawVad(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	data: VadFrame[],
	palette: ViewerPalette,
	normalizeMax?: number
): void {
	if (!data || data.length === 0) return;

	const { zoom } = viewport;
	const { viewStart, viewEnd } = viewBounds(viewport);
	const scale = normalizeMax ? 1 / normalizeMax : 1;

	const startIdx = binarySearchStart(data, viewStart);
	const endIdx = binarySearchEnd(data, viewEnd);

	ctx.fillStyle = palette.vadFill;
	for (let i = startIdx; i <= endIdx && i < data.length; i++) {
		const frame = data[i];
		const x = timeToPx(frame.time_range.start, zoom);
		const w = Math.max(timeToPx(frame.time_range.end - frame.time_range.start, zoom), 1);
		const h = Math.min(frame.speech_probability * scale, 1) * (height - 4);
		ctx.fillRect(x, height - h - 2, w, h);
	}

	// Threshold line at 0.5 (skip if scaled threshold exceeds track)
	const scaledThreshold = 0.5 * scale;
	if (scaledThreshold <= 1) {
		const thresholdY = height - scaledThreshold * (height - 4) - 2;
		ctx.strokeStyle = palette.vadThreshold;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(0, thresholdY);
		ctx.lineTo(width, thresholdY);
		ctx.stroke();
		ctx.setLineDash([]);
	}
}

export function drawDiarization(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	data: DiarizationSegment[],
	palette: ViewerPalette
): void {
	if (!data || data.length === 0) return;

	const { zoom } = viewport;
	const { viewStart, viewEnd } = viewBounds(viewport);

	const speakerColors: Record<string, { bg: string; border: string }> = {
		SPEAKER_00: palette.speaker0,
		SPEAKER_01: palette.speaker1,
	};

	// Turn block: speaker tint, 2px solid left bar, mono "S0" tag (see timeline-screen)
	const inset = 5;
	const barW = 2;
	const blockH = Math.max(height - inset * 2, 1);

	ctx.font = CANVAS_TAG_FONT;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';

	// Viewport cull: only the turns overlapping the window
	const startIdx = binarySearchStart(data, viewStart);
	const endIdx = binarySearchEnd(data, viewEnd);

	for (let i = startIdx; i <= endIdx && i < data.length; i++) {
		const seg = data[i];
		const x = timeToPx(seg.time_range.start, zoom);
		const w = timeToPx(seg.time_range.end - seg.time_range.start, zoom);

		const speaker = seg.diarization.speaker;
		const colors = speakerColors[speaker] ?? palette.speakerDefault;
		const drawW = Math.max(w - 1.5, 2);

		ctx.fillStyle = colors.bg;
		ctx.fillRect(x, inset, drawW, blockH);
		ctx.fillStyle = colors.border;
		ctx.fillRect(x, inset, Math.min(barW, drawW), blockH);

		if (w > 30) {
			const match = /(\d+)$/.exec(speaker);
			const label = match ? `S${Number(match[1])}` : speaker;
			ctx.fillText(label, x + barW + 5, height / 2);
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
	peaksSampleRate: number,
	palette: ViewerPalette,
	normalizeMax?: number
): void {
	if (!peaksL || peaksL.length === 0) return;

	const { scrollLeft, zoom, containerWidth } = viewport;
	const scale = normalizeMax ? 1 / normalizeMax : 1;
	// Only draw the visible pixel range
	const pxStart = Math.max(0, Math.floor(scrollLeft));
	const pxEnd = Math.min(width, Math.ceil(scrollLeft + containerWidth));

	if (peaksR) {
		// Stereo: top half = left, bottom half = right
		const halfH = height / 2;

		// Left channel (top)
		ctx.fillStyle = palette.waveformL;
		drawChannelBars(ctx, peaksL, peaksSampleRate, zoom, pxStart, pxEnd, 0, halfH, false, scale);

		// Right channel (bottom)
		ctx.fillStyle = palette.waveformR;
		drawChannelBars(ctx, peaksR, peaksSampleRate, zoom, pxStart, pxEnd, halfH, halfH, true, scale);

		// Center line
		ctx.strokeStyle = palette.waveformCenter;
		ctx.beginPath();
		ctx.moveTo(pxStart, halfH);
		ctx.lineTo(pxEnd, halfH);
		ctx.stroke();
	} else {
		// Mono: mirrored around center
		const centerY = height / 2;
		ctx.fillStyle = palette.waveformMono;

		for (let px = pxStart; px < pxEnd; px++) {
			const time = px / zoom;
			const sampleIdx = Math.floor(time * peaksSampleRate);
			if (sampleIdx < 0 || sampleIdx >= peaksL.length) continue;

			const peak = peaksL[sampleIdx];
			const barH = Math.min(peak * scale, 1) * (centerY - 2);
			ctx.fillRect(px, centerY - barH, 1, barH * 2);
		}

		// Center line
		ctx.strokeStyle = palette.centerLine;
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
	fromTop: boolean,
	scale: number = 1
): void {
	for (let px = pxStart; px < pxEnd; px++) {
		const time = px / zoom;
		const sampleIdx = Math.floor(time * peaksSampleRate);
		if (sampleIdx < 0 || sampleIdx >= peaks.length) continue;

		const peak = peaks[sampleIdx];
		const barH = Math.min(peak * scale, 1) * (halfH - 2);
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
	data: MouthEnergySegment[],
	palette: ViewerPalette,
	normalizeMax?: number
): void {
	if (!data || data.length === 0) return;

	const { zoom } = viewport;
	const { viewStart, viewEnd } = viewBounds(viewport);
	const scale = normalizeMax ? 1 / normalizeMax : 1;

	const startIdx = binarySearchStart(data, viewStart);
	const endIdx = binarySearchEnd(data, viewEnd);

	if (startIdx > endIdx) return;

	ctx.strokeStyle = palette.mouthEnergy;
	ctx.lineWidth = 1.5;
	ctx.beginPath();

	let started = false;
	for (let i = startIdx; i <= endIdx && i < data.length; i++) {
		const seg = data[i];
		const midpoint = (seg.time_range.start + seg.time_range.end) / 2;
		const x = timeToPx(midpoint, zoom);
		const val = Math.min(seg.mouth_energy.mouth_energy * scale, 1);
		const y = height - (val * (height - 8)) - 4;

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

/** Head pose y-range (± degrees) when not normalized (timeline-screen: ±30°) */
export const DEFAULT_POSE_RANGE = 30;

export function drawHeadPose(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	data: FacialTrackingFrame[],
	palette: ViewerPalette,
	normalizeRange?: { min: number; max: number }
): void {
	if (!data || data.length === 0) return;

	const { scrollLeft, zoom, containerWidth } = viewport;
	const viewStart = scrollLeft / zoom;
	const viewEnd = (scrollLeft + containerWidth) / zoom;

	const pMin = normalizeRange ? normalizeRange.min : -DEFAULT_POSE_RANGE;
	const pMax = normalizeRange ? normalizeRange.max : DEFAULT_POSE_RANGE;
	const pRange = pMax - pMin || 1;

	function normalizePose(degrees: number): number {
		return Math.max(0, Math.min(1, (degrees - pMin) / pRange));
	}

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

	// Center line at 0 degrees
	const zeroNorm = normalizePose(0);
	if (zeroNorm > 0 && zeroNorm < 1) {
		const centerY = height - zeroNorm * (height - 8) - 4;
		ctx.strokeStyle = palette.centerLine;
		ctx.setLineDash([2, 4]);
		ctx.beginPath();
		ctx.moveTo(Math.max(0, scrollLeft), centerY);
		ctx.lineTo(Math.min(width, scrollLeft + containerWidth), centerY);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Draw each axis as a line
	const axisColors = [palette.headPitch, palette.headYaw, palette.headRoll];

	for (let axisIdx = 0; axisIdx < 3; axisIdx++) {
		ctx.strokeStyle = axisColors[axisIdx];
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
