<script lang="ts">
	import { onMount } from 'svelte';
	import { getTimelineState, getAnnotationDataState, getSessionState } from '../context.js';
	import { findNearestFrame, interpolateDepth, drawMeshWireframe } from '../mesh-overlay.js';
	import { PALETTE_DARK, PALETTE_LIGHT } from '../viewer-palette.js';
	import { getTheme } from '$lib/stores/theme.svelte';
	import { browser } from '$app/environment';

	interface Props {
		videoEl: HTMLVideoElement;
	}

	let { videoEl }: Props = $props();

	const timeline = getTimelineState();
	const annotations = getAnnotationDataState();
	const session = getSessionState();
	const theme = getTheme();

	let canvasEl: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let rvfcHandle: number | null = null;
	let prefersDark = $state(browser ? window.matchMedia('(prefers-color-scheme: dark)').matches : true);

	const isDark = $derived(
		theme.value === 'dark' || (theme.value === 'system' && prefersDark),
	);
	const palette = $derived(isDark ? PALETTE_DARK : PALETTE_LIGHT);

	function syncCanvasSize() {
		if (!canvasEl || !videoEl) return;
		const w = videoEl.videoWidth;
		const h = videoEl.videoHeight;
		if (w > 0 && h > 0 && (canvasEl.width !== w || canvasEl.height !== h)) {
			canvasEl.width = w;
			canvasEl.height = h;
		}
	}

	function renderFrame(time: number) {
		if (!ctx) return;

		const ft = annotations.facialTracking;
		if (!ft || !ft.metadata.mesh_topology) return;

		const frame = findNearestFrame(ft.data, time);
		if (!frame || !frame.facial_tracking.tracking.face_detected) {
			ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
			return;
		}

		const landmarks = frame.facial_tracking.tracking.landmarks;
		const depth = interpolateDepth(ft.mesh_keyframes, time);

		ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
		ctx.globalAlpha = session.meshOverlayOpacity;
		drawMeshWireframe(ctx, landmarks, depth, ft.metadata.mesh_topology, palette);
		ctx.globalAlpha = 1;
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

	// Re-render when palette or opacity changes
	$effect(() => {
		void palette;
		void session.meshOverlayOpacity;
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

		const onMetadata = () => syncCanvasSize();
		videoEl.addEventListener('loadedmetadata', onMetadata);

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const onSchemeChange = (e: MediaQueryListEvent) => {
			prefersDark = e.matches;
		};
		mediaQuery.addEventListener('change', onSchemeChange);

		// If video already loaded, sync immediately
		if (videoEl.readyState >= 1) syncCanvasSize();

		return () => {
			stopRvfc();
			videoEl.removeEventListener('loadedmetadata', onMetadata);
			mediaQuery.removeEventListener('change', onSchemeChange);
		};
	});
</script>

<canvas
	bind:this={canvasEl}
	class="absolute inset-0 w-full h-full pointer-events-none"
	aria-hidden="true"
></canvas>
