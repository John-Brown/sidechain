import { describe, it, expect } from 'vitest';
import { TimelineState } from './timeline.svelte';

describe('TimelineState', () => {
	it('timeToPx and pxToTime are inverse operations', () => {
		const tl = new TimelineState();
		tl.zoom = 10;

		expect(tl.timeToPx(5)).toBe(50);
		expect(tl.pxToTime(50)).toBe(5);
		expect(tl.pxToTime(tl.timeToPx(7.3))).toBeCloseTo(7.3);
	});

	it('timeToPx/pxToTime roundtrip at fractional zoom', () => {
		const tl = new TimelineState();
		tl.zoom = 3.5;

		const time = 12.8;
		expect(tl.pxToTime(tl.timeToPx(time))).toBeCloseTo(time);
	});

	it('viewStartTime and viewEndTime with scrollLeft=0', () => {
		const tl = new TimelineState();
		tl.zoom = 10;
		tl.containerWidth = 500;
		tl.duration = 60;
		tl.scrollLeft = 0;

		expect(tl.viewStartTime).toBe(0);
		expect(tl.viewEndTime).toBe(50);
	});

	it('viewStartTime reflects scroll position', () => {
		const tl = new TimelineState();
		tl.zoom = 10;
		tl.containerWidth = 500;
		tl.duration = 60;
		tl.scrollLeft = 100;

		expect(tl.viewStartTime).toBe(10);
		expect(tl.viewEndTime).toBe(60);
	});

	it('maxScrollLeft = duration * zoom - containerWidth', () => {
		const tl = new TimelineState();
		tl.duration = 60;
		tl.zoom = 10;
		tl.containerWidth = 200;

		expect(tl.maxScrollLeft).toBe(400);
	});

	it('maxScrollLeft is 0 when content fits in container', () => {
		const tl = new TimelineState();
		tl.duration = 10;
		tl.zoom = 10;
		tl.containerWidth = 200;

		expect(tl.maxScrollLeft).toBe(0);
	});

	it('clampedScrollLeft clamps negative to 0 and excess to max', () => {
		const tl = new TimelineState();
		tl.duration = 60;
		tl.zoom = 10;
		tl.containerWidth = 200;
		// maxScrollLeft = 400

		tl.scrollLeft = -50;
		expect(tl.clampedScrollLeft).toBe(0);

		tl.scrollLeft = 999;
		expect(tl.clampedScrollLeft).toBe(400);

		tl.scrollLeft = 200;
		expect(tl.clampedScrollLeft).toBe(200);
	});

	it('fitZoomToContainer sets zoom based on container and duration', () => {
		const tl = new TimelineState();
		tl.duration = 60;
		tl.containerWidth = 640;

		tl.fitZoomToContainer();

		expect(tl.zoom).toBe((640 - 40) / 60); // 10
	});

	it('fitZoomToContainer is idempotent — second call is a no-op', () => {
		const tl = new TimelineState();
		tl.duration = 60;
		tl.containerWidth = 640;

		tl.fitZoomToContainer();
		const firstZoom = tl.zoom;

		tl.containerWidth = 1280;
		tl.fitZoomToContainer();

		expect(tl.zoom).toBe(firstZoom);
	});
});
