<script lang="ts">
	import { onMount } from 'svelte';
	import { getTimelineState, getAnnotationDataState, getSessionState } from '../context.js';
	import { findNearestFrame, interpolateDepth, drawMeshWireframe } from '../mesh-overlay.js';
	import { PALETTE_DARK, PALETTE_LIGHT } from '../viewer-palette.js';
	import { browser } from '$app/environment';

	interface Props {
		videoEl: HTMLVideoElement;
	}

	let { videoEl }: Props = $props();

	const timeline = getTimelineState();
	const annotations = getAnnotationDataState();
	const session = getSessionState();

	let canvasEl: HTMLCanvasElement;
	let boxEl: HTMLDivElement;
	let boxLabelEl: HTMLSpanElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let rvfcHandle: number | null = null;

	// Night = the .dark class on <html> (ThemeToggle, the dev route's ?theme=night); observed so the mesh follows it.
	let isDark = $state(browser ? document.documentElement.classList.contains('dark') : false);
	const palette = $derived(isDark ? PALETTE_DARK : PALETTE_LIGHT);

	/** Padding around the landmark bounds for the face box, as a fraction of the face size. */
	const BOX_PAD = 0.12;

	/** Canvas matches the video's intrinsic size; falls back to the tracking metadata when there is no video frame. */
	function syncCanvasSize() {
		if (!canvasEl) return;
		const meta = annotations.facialTracking?.metadata;
		const w = videoEl?.videoWidth || meta?.video_width || 0;
		const h = videoEl?.videoHeight || meta?.video_height || 0;
		if (w > 0 && h > 0 && (canvasEl.width !== w || canvasEl.height !== h)) {
			canvasEl.width = w;
			canvasEl.height = h;
		}
	}

	function hideBox() {
		if (boxEl) boxEl.style.display = 'none';
	}

	/**
	 * Position the face box (DOM, amber ornament corners + "FACE 0 · 0.97") over the
	 * landmark bounds. Canvas and box share the stage; the canvas is object-contain,
	 * so map intrinsic pixels through the same letterbox. Imperative style writes only.
	 */
	function placeBox(landmarks: [number, number, number][], confidence: number) {
		if (!boxEl || !canvasEl || landmarks.length === 0) return hideBox();
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const [x, y] of landmarks) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
		const cw = canvasEl.clientWidth;
		const ch = canvasEl.clientHeight;
		const iw = canvasEl.width;
		const ih = canvasEl.height;
		if (!cw || !ch || !iw || !ih) return hideBox();
		const scale = Math.min(cw / iw, ch / ih);
		const ox = (cw - iw * scale) / 2;
		const oy = (ch - ih * scale) / 2;
		const padX = (maxX - minX) * BOX_PAD;
		const padY = (maxY - minY) * BOX_PAD;
		const left = ox + (minX - padX) * scale;
		const top = oy + (minY - padY) * scale;
		const width = (maxX - minX + 2 * padX) * scale;
		const height = (maxY - minY + 2 * padY) * scale;
		boxEl.style.display = 'block';
		boxEl.style.transform = `translate(${left}px, ${top}px)`;
		boxEl.style.width = `${width}px`;
		boxEl.style.height = `${height}px`;
		boxLabelEl.textContent = `FACE 0 · ${confidence.toFixed(2)}`;
	}

	function renderFrame(time: number) {
		if (!ctx) return;

		const ft = annotations.facialTracking;
		if (!ft || !ft.metadata.mesh_topology) {
			hideBox();
			return;
		}

		syncCanvasSize();
		const frame = findNearestFrame(ft.data, time);
		if (!frame || !frame.facial_tracking.tracking.face_detected) {
			ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
			hideBox();
			return;
		}

		const tracking = frame.facial_tracking.tracking;
		const depth = interpolateDepth(ft.mesh_keyframes, time);

		ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
		ctx.globalAlpha = session.meshOverlayOpacity;
		drawMeshWireframe(ctx, tracking.landmarks, depth, ft.metadata.mesh_topology, palette);
		ctx.globalAlpha = 1;
		placeBox(tracking.landmarks, tracking.confidence);
	}

	function onRvfc(_now: DOMHighResTimeStamp, metadata: { mediaTime: number }) {
		renderFrame(metadata.mediaTime);
		rvfcHandle = videoEl.requestVideoFrameCallback(onRvfc);
	}

	function startRvfc() {
		stopRvfc();
		if ('requestVideoFrameCallback' in videoEl) {
			rvfcHandle = videoEl.requestVideoFrameCallback(onRvfc);
		}
	}

	function stopRvfc() {
		if (rvfcHandle !== null && 'cancelVideoFrameCallback' in videoEl) {
			videoEl.cancelVideoFrameCallback(rvfcHandle);
			rvfcHandle = null;
		}
	}

	// Scrub/seek sync when paused
	$effect(() => {
		const time = timeline.currentTime;
		if (!timeline.playing) {
			renderFrame(time);
		}
	});

	// Re-render when palette, opacity or data changes
	$effect(() => {
		void palette;
		void session.meshOverlayOpacity;
		void annotations.facialTracking;
		if (!timeline.playing) {
			renderFrame(timeline.currentTime);
		}
	});

	// Start/stop RVFC based on play state
	$effect(() => {
		if (timeline.playing) {
			startRvfc();
		} else {
			stopRvfc();
		}
	});

	onMount(() => {
		ctx = canvasEl.getContext('2d');
		syncCanvasSize();

		const onMetadata = () => {
			syncCanvasSize();
			if (!timeline.playing) renderFrame(timeline.currentTime);
		};
		videoEl.addEventListener('loadedmetadata', onMetadata);

		const themeObserver = new MutationObserver(() => {
			isDark = document.documentElement.classList.contains('dark');
		});
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		// Keep the face box on the face when the stage resizes (PiP return, window resize).
		const resizeObserver = new ResizeObserver(() => {
			if (!timeline.playing) renderFrame(timeline.currentTime);
		});
		resizeObserver.observe(canvasEl);

		// If video already loaded, sync immediately
		if (videoEl.readyState >= 1) syncCanvasSize();

		return () => {
			stopRvfc();
			videoEl.removeEventListener('loadedmetadata', onMetadata);
			themeObserver.disconnect();
			resizeObserver.disconnect();
		};
	});
</script>

<canvas
	bind:this={canvasEl}
	class="absolute inset-0 w-full h-full object-contain pointer-events-none"
	aria-hidden="true"
></canvas>
<div bind:this={boxEl} class="face-box" aria-hidden="true">
	<span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
	<span bind:this={boxLabelEl} class="face-label font-mono text-viewer-xs"></span>
</div>

<style>
	/* Ornament only (amber): identifies the tracked face, carries no state. */
	.face-box {
		display: none;
		position: absolute;
		left: 0;
		top: 0;
		pointer-events: none;
		will-change: transform;
	}

	.corner {
		position: absolute;
		width: 14px;
		height: 14px;
		border: 0 solid var(--viewer-ornament);
	}

	.tl { left: 0; top: 0; border-left-width: 2px; border-top-width: 2px; }
	.tr { right: 0; top: 0; border-right-width: 2px; border-top-width: 2px; }
	.bl { left: 0; bottom: 0; border-left-width: 2px; border-bottom-width: 2px; }
	.br { right: 0; bottom: 0; border-right-width: 2px; border-bottom-width: 2px; }

	.face-label {
		position: absolute;
		left: 0;
		top: -18px;
		letter-spacing: 0.05em;
		white-space: nowrap;
		color: var(--viewer-ornament);
	}
</style>
