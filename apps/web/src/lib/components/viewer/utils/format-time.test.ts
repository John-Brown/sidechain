import { describe, it, expect } from 'vitest';
import { formatTime, formatTimePrecise } from './format-time.js';

describe('formatTime', () => {
	it('formats zero seconds', () => {
		expect(formatTime(0)).toBe('0:00');
	});

	it('formats single-digit seconds with leading zero', () => {
		expect(formatTime(5)).toBe('0:05');
	});

	it('formats double-digit seconds', () => {
		expect(formatTime(45)).toBe('0:45');
	});

	it('formats minutes and seconds', () => {
		expect(formatTime(125)).toBe('2:05');
	});

	it('floors fractional seconds', () => {
		expect(formatTime(3.7)).toBe('0:03');
		expect(formatTime(59.999)).toBe('0:59');
	});

	it('formats large values (over an hour)', () => {
		expect(formatTime(3661)).toBe('61:01');
	});
});

describe('formatTimePrecise', () => {
	it('formats zero with three decimal places', () => {
		expect(formatTimePrecise(0)).toBe('0:00.000');
	});

	it('formats precise fractional seconds', () => {
		expect(formatTimePrecise(3.456)).toBe('0:03.456');
	});

	it('pads seconds below 10 with leading zero', () => {
		expect(formatTimePrecise(5.1)).toBe('0:05.100');
	});

	it('formats minutes with precise seconds', () => {
		expect(formatTimePrecise(90.123)).toBe('1:30.123');
	});

	it('formats whole seconds with .000', () => {
		expect(formatTimePrecise(10)).toBe('0:10.000');
	});

	it('handles sub-second values', () => {
		expect(formatTimePrecise(0.042)).toBe('0:00.042');
	});

	it('formats large values precisely', () => {
		expect(formatTimePrecise(3661.5)).toBe('61:01.500');
	});
});
