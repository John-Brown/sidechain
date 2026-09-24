<script lang="ts">
	import { onMount } from 'svelte';
	import { getTimelineState } from '../context.js';
	import type { Viewport } from '../types.js';

	/**
	 * Canvas track. The container is laid out at absolute timeline coordinates
	 * (full timeline width, x=0 is time=0) and draw functions keep using those
	 * coordinates, but the canvas itself is only viewport-sized: it sits at
	 * translateX(scrollLeft) and the context is translated by -scrollLeft. That
	 * keeps the backing store small at any zoom (no 32k px canvas limit) and
	 * makes each redraw proportional to the viewport.
	 *
	 * Redraws are driven by the $effect below, which tracks everything `draw`
	 * reads (viewport, data, palette). There is no per-frame loop: nothing a
	 * canvas draws depends on currentTime, and scrolling already triggers it.
	 */
	interface Props {
		height?: number;
		/** `width` is the full timeline width; draw in absolute px (time * zoom). */
		draw: (ctx: CanvasRenderingContext2D, width: number, height: number, viewport: Viewport) => void;
		onScrub?: (time: number) => void;
	}

	let { height = 48, draw, onScrub }: Props = $props();

	const timeline = getTimelineState();

	let canvasEl: HTMLCanvasElement;
	let containerEl: HTMLDivElement;
	/** Full (timeline) width of the container */
	let canvasWidth = $state(0);
	/** Bumped when web fonts finish loading, so text drawn with a fallback font is redrawn */
	let fontVersion = $state(0);
	let cachedCtx: CanvasRenderingContext2D | null = null;
	let backingW = 0;
	let backingH = 0;
	let backingDpr = 0;

	function redraw() {
		if (!canvasEl) return;
		const dpr = window.devicePixelRatio || 1;
		const fullW = canvasWidth;
		const h = height;
		const scrollLeft = timeline.clampedScrollLeft;
		const viewW = timeline.containerWidth > 0 ? timeline.containerWidth : fullW;
		const left = Math.max(0, Math.min(scrollLeft, fullW));
		const w = Math.max(0, Math.min(viewW, fullW - left));

		// Resize the backing store only when its size changes (resizing clears and reallocates)
		const bw = Math.ceil(w * dpr);
		const bh = Math.ceil(h * dpr);
		if (bw !== backingW || bh !== backingH || dpr !== backingDpr) {
			canvasEl.width = bw;
			canvasEl.height = bh;
			canvasEl.style.width = `${w}px`;
			canvasEl.style.height = `${h}px`;
			backingW = bw;
			backingH = bh;
			backingDpr = dpr;
		}
		canvasEl.style.transform = `translateX(${left}px)`;

		const ctx = cachedCtx ?? canvasEl.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, bw, bh);
		if (w <= 0) return;
		// Absolute timeline coordinates: x=0 is time 0
		ctx.setTransform(dpr, 0, 0, dpr, -left * dpr, 0);
		draw(ctx, fullW, h, {
			scrollLeft,
			zoom: timeline.zoom,
			duration: timeline.duration,
			containerWidth: viewW,
		});
	}

	// Redraw when the viewport, size, fonts or anything `draw` reads changes
	$effect(() => {
		fontVersion;
		redraw();
	});

	// Cache canvas context, observe size, and redraw once web fonts are ready
	onMount(() => {
		cachedCtx = canvasEl.getContext('2d');
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				canvasWidth = entry.contentRect.width;
			}
		});
		observer.observe(containerEl);

		const fonts = document.fonts;
		const onFontsLoaded = () => fontVersion++;
		fonts?.ready.then(onFontsLoaded);
		fonts?.addEventListener('loadingdone', onFontsLoaded);

		return () => {
			observer.disconnect();
			fonts?.removeEventListener('loadingdone', onFontsLoaded);
		};
	});

	// Scrub handlers
	function handlePointerDown(e: PointerEvent) {
		if (!onScrub || e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		timeline.scrubbing = true;
		scrubAt(e);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!timeline.scrubbing || !onScrub) return;
		scrubAt(e);
	}

	function handlePointerUp(e: PointerEvent) {
		if (!onScrub) return;
		const el = e.currentTarget as HTMLElement;
		if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
		timeline.scrubbing = false;
	}

	function scrubAt(e: PointerEvent) {
		// The container spans the full timeline, so its rect maps clientX to absolute px
		const rect = containerEl.getBoundingClientRect();
		const time = timeline.pxToTime(e.clientX - rect.left);
		onScrub?.(Math.max(0, Math.min(time, timeline.duration)));
	}
</script>

<div
	bind:this={containerEl}
	class="relative w-full overflow-hidden"
	style="height: {height}px"
>
	<canvas
		bind:this={canvasEl}
		class="absolute top-0 left-0"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
	></canvas>
</div>
