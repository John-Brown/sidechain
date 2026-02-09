<script lang="ts">
	import { onMount } from 'svelte';
	import { getTimelineState } from '../context.js';
	import type { Viewport } from '../types.js';

	interface Props {
		height?: number;
		draw: (ctx: CanvasRenderingContext2D, width: number, height: number, viewport: Viewport) => void;
		onScrub?: (time: number) => void;
	}

	let { height = 48, draw, onScrub }: Props = $props();

	const timeline = getTimelineState();

	let canvasEl: HTMLCanvasElement;
	let containerEl: HTMLDivElement;
	let canvasWidth = $state(0);
	let rafId = 0;
	let cachedCtx: CanvasRenderingContext2D | null = null;

	function redraw() {
		if (!canvasEl) return;
		const dpr = window.devicePixelRatio || 1;
		const w = canvasWidth;
		const h = height;
		canvasEl.width = w * dpr;
		canvasEl.height = h * dpr;
		const ctx = cachedCtx ?? canvasEl.getContext('2d')!;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, w, h);
		draw(ctx, w, h, { scrollLeft: timeline.clampedScrollLeft, zoom: timeline.zoom, duration: timeline.duration, containerWidth: timeline.containerWidth });
	}

	function animationLoop() {
		redraw();
		if (timeline.playing || timeline.scrubbing) {
			rafId = requestAnimationFrame(animationLoop);
		}
	}

	// Redraw when viewport changes (zoom, scroll)
	$effect(() => {
		timeline.zoom;
		timeline.scrollLeft;
		timeline.duration;
		redraw();
	});

	// Start/stop animation loop when playing
	$effect(() => {
		if (timeline.playing || timeline.scrubbing) {
			rafId = requestAnimationFrame(animationLoop);
		}
		return () => {
			if (rafId) cancelAnimationFrame(rafId);
		};
	});

	// Cache canvas context and set up ResizeObserver
	onMount(() => {
		cachedCtx = canvasEl.getContext('2d');
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				canvasWidth = entry.contentRect.width;
			}
		});
		observer.observe(containerEl);
		return () => observer.disconnect();
	});

	// Scrub handlers
	function handlePointerDown(e: PointerEvent) {
		if (!onScrub) return;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		timeline.scrubbing = true;
		scrubAt(e);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!timeline.scrubbing || !onScrub) return;
		scrubAt(e);
	}

	function handlePointerUp() {
		if (!onScrub) return;
		timeline.scrubbing = false;
	}

	function scrubAt(e: PointerEvent) {
		const rect = canvasEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		// x is already the absolute pixel offset in the canvas (getBoundingClientRect accounts for scroll)
		const time = timeline.pxToTime(x);
		onScrub?.(Math.max(0, Math.min(time, timeline.duration)));
	}
</script>

<div
	bind:this={containerEl}
	class="relative w-full"
	style="height: {height}px"
>
	<canvas
		bind:this={canvasEl}
		class="absolute inset-0 w-full h-full"
		style="width: {canvasWidth}px; height: {height}px"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
	></canvas>
</div>
