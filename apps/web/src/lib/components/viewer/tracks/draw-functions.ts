import { binarySearchStart, binarySearchEnd } from '../utils/binary-search.js';
import type { Viewport } from '../types.js';
import type { VadSegment, DiarizationSegment, MouthEnergySegment } from '@annotation/shared';

function timeToPx(time: number, zoom: number): number {
	return time * zoom;
}

export function drawRuler(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport
): void {
	const { scrollLeft, zoom, duration } = viewport;

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
		const x = timeToPx(t, zoom) - scrollLeft;
		if (x < -10 || x > width + 10) continue;

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
	data: VadSegment[]
): void {
	if (!data || data.length === 0) return;

	const { scrollLeft, zoom } = viewport;
	const viewStart = scrollLeft / zoom;
	const viewEnd = (scrollLeft + width) / zoom;

	const startIdx = binarySearchStart(data, viewStart);
	const endIdx = binarySearchEnd(data, viewEnd);

	ctx.fillStyle = 'rgba(99, 102, 241, 0.6)';
	for (let i = startIdx; i <= endIdx && i < data.length; i++) {
		const seg = data[i];
		const x = timeToPx(seg.time_range.start, zoom) - scrollLeft;
		const w = Math.max(timeToPx(seg.time_range.end - seg.time_range.start, zoom), 1);
		const h = seg.voice_activity.speech_probability * (height - 4);
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

export function drawEnergy(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	data: VadSegment[]
): void {
	if (!data || data.length === 0) return;

	const { scrollLeft, zoom } = viewport;
	const viewStart = scrollLeft / zoom;
	const viewEnd = (scrollLeft + width) / zoom;

	const startIdx = binarySearchStart(data, viewStart);
	const endIdx = binarySearchEnd(data, viewEnd);

	const halfH = height / 2;

	// Left channel (above center)
	ctx.fillStyle = 'rgba(34, 211, 238, 0.4)';
	for (let i = startIdx; i <= endIdx && i < data.length; i++) {
		const seg = data[i];
		const x = timeToPx(seg.time_range.start, zoom) - scrollLeft;
		const w = Math.max(timeToPx(seg.time_range.end - seg.time_range.start, zoom), 1);
		const norm = Math.max(0, Math.min(1, (seg.voice_activity.energy_dbfs_left + 80) / 80));
		const barH = norm * (halfH - 2);
		ctx.fillRect(x, halfH - barH, w, barH);
	}

	// Right channel (below center)
	ctx.fillStyle = 'rgba(244, 114, 182, 0.4)';
	for (let i = startIdx; i <= endIdx && i < data.length; i++) {
		const seg = data[i];
		const x = timeToPx(seg.time_range.start, zoom) - scrollLeft;
		const w = Math.max(timeToPx(seg.time_range.end - seg.time_range.start, zoom), 1);
		const norm = Math.max(0, Math.min(1, (seg.voice_activity.energy_dbfs_right + 80) / 80));
		const barH = norm * (halfH - 2);
		ctx.fillRect(x, halfH, w, barH);
	}

	// Center line
	ctx.strokeStyle = '#2e3345';
	ctx.beginPath();
	ctx.moveTo(0, halfH);
	ctx.lineTo(width, halfH);
	ctx.stroke();
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

	const { scrollLeft, zoom } = viewport;

	ctx.font = '9px monospace';
	ctx.textBaseline = 'middle';

	for (const seg of data) {
		const x = timeToPx(seg.time_range.start, zoom) - scrollLeft;
		const w = timeToPx(seg.time_range.end - seg.time_range.start, zoom);

		if (x + w < 0 || x > width) continue;

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

export function drawMouthEnergy(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	viewport: Viewport,
	data: MouthEnergySegment[]
): void {
	if (!data || data.length === 0) return;

	const { scrollLeft, zoom } = viewport;
	const viewStart = scrollLeft / zoom;
	const viewEnd = (scrollLeft + width) / zoom;

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
		const x = timeToPx(midpoint, zoom) - scrollLeft;
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
