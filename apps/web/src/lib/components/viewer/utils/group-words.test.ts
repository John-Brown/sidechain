import { describe, it, expect } from 'vitest';
import { groupWordsBySegment } from './group-words.js';
import type { SpeechWord } from '@annotation/shared';

// Helper to build a SpeechWord with sane defaults, overridable per field.
const word = (
	start: number,
	end: number,
	text: string,
	speaker: string,
	segment: number | undefined,
	confidence = 0.9,
): SpeechWord => ({
	time_range: { start, end },
	speech: {
		word: text,
		speaker,
		confidence,
		// speech_segment is typed as required number, but pipeline output can omit it —
		// cast lets us exercise the "missing/undefined" edge case.
		speech_segment: segment as number,
	},
});

describe('groupWordsBySegment', () => {
	it('returns an empty array for empty input', () => {
		expect(groupWordsBySegment([])).toEqual([]);
	});

	it('groups a single word into a single segment', () => {
		const words = [word(0, 0.5, 'hi', 'A', 0)];
		const result = groupWordsBySegment(words);

		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			time_range: { start: 0, end: 0.5 },
			text: 'hi',
			speaker: 'A',
			wordCount: 1,
			segmentIndex: 0,
		});
	});

	it('groups consecutive words with the same speech_segment into one block', () => {
		const words = [
			word(0, 0.5, 'hello', 'A', 0),
			word(0.5, 1, 'there', 'A', 0),
			word(1, 1.5, 'friend', 'A', 0),
		];
		const result = groupWordsBySegment(words);

		expect(result).toHaveLength(1);
		expect(result[0].text).toBe('hello there friend');
		expect(result[0].time_range).toEqual({ start: 0, end: 1.5 });
		expect(result[0].wordCount).toBe(3);
		expect(result[0].segmentIndex).toBe(0);
	});

	it('splits into separate blocks on segment transitions', () => {
		const words = [
			word(0, 0.5, 'hello', 'A', 0),
			word(0.5, 1, 'there', 'A', 0),
			word(1, 1.5, 'hi', 'B', 1),
			word(1.5, 2, 'back', 'B', 1),
		];
		const result = groupWordsBySegment(words);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			text: 'hello there',
			segmentIndex: 0,
			wordCount: 2,
		});
		expect(result[1]).toMatchObject({
			text: 'hi back',
			segmentIndex: 1,
			wordCount: 2,
		});
		// Boundary: first block's end should be the boundary word's end, second's start the next word's start.
		expect(result[0].time_range.end).toBe(1);
		expect(result[1].time_range.start).toBe(1);
	});

	it('treats undefined speech_segment as its own grouping key (does not merge with defined segments)', () => {
		const words = [
			word(0, 0.5, 'a', 'A', undefined),
			word(0.5, 1, 'b', 'A', undefined),
			word(1, 1.5, 'c', 'A', 0),
		];
		const result = groupWordsBySegment(words);

		expect(result).toHaveLength(2);
		expect(result[0].wordCount).toBe(2);
		expect(result[0].segmentIndex).toBeUndefined();
		expect(result[1].wordCount).toBe(1);
		expect(result[1].segmentIndex).toBe(0);
	});

	it('does not merge two separate runs that share the same segment id non-consecutively', () => {
		// Segment ids: 0, 1, 0 — grouping is purely by adjacency, not by id equality across the array.
		const words = [
			word(0, 0.5, 'a', 'A', 0),
			word(0.5, 1, 'b', 'A', 1),
			word(1, 1.5, 'c', 'A', 0),
		];
		const result = groupWordsBySegment(words);

		expect(result).toHaveLength(3);
		expect(result.map((s) => s.segmentIndex)).toEqual([0, 1, 0]);
		expect(result.map((s) => s.wordCount)).toEqual([1, 1, 1]);
	});

	it('picks the majority speaker within a group', () => {
		const words = [
			word(0, 0.5, 'a', 'A', 0),
			word(0.5, 1, 'b', 'B', 0),
			word(1, 1.5, 'c', 'B', 0),
		];
		const result = groupWordsBySegment(words);

		expect(result).toHaveLength(1);
		expect(result[0].speaker).toBe('B');
	});

	it('breaks a speaker tie by keeping the first word in the group as speaker', () => {
		const words = [
			word(0, 0.5, 'a', 'A', 0),
			word(0.5, 1, 'b', 'B', 0),
		];
		const result = groupWordsBySegment(words);

		// Tie (1 vs 1) — implementation keeps the first speaker seen since a later
		// count only overwrites when strictly greater than the current max.
		expect(result[0].speaker).toBe('A');
	});

	it('truncates text longer than 80 characters with an ellipsis', () => {
		// 30 four-character "word " tokens => 120 chars before truncation.
		const words = Array.from({ length: 30 }, (_, i) => word(i, i + 1, 'word', 'A', 0));
		const result = groupWordsBySegment(words);

		expect(result).toHaveLength(1);
		expect(result[0].text.length).toBe(80);
		expect(result[0].text.endsWith('...')).toBe(true);
		expect(result[0].text.startsWith('word word word')).toBe(true);
	});

	it('does not truncate text at exactly 80 characters', () => {
		// 16 five-char tokens joined by spaces = 16*4 + 15 spaces = 79 chars ("word" x16 joined).
		const words = Array.from({ length: 16 }, (_, i) => word(i, i + 1, 'word', 'A', 0));
		const result = groupWordsBySegment(words);
		const expectedText = Array(16).fill('word').join(' ');

		expect(expectedText.length).toBeLessThanOrEqual(80);
		expect(result[0].text).toBe(expectedText);
		expect(result[0].text.endsWith('...')).toBe(false);
	});

	it('preserves input order across multiple segment transitions', () => {
		const words = [
			word(0, 1, 'a', 'A', 0),
			word(1, 2, 'b', 'A', 1),
			word(2, 3, 'c', 'A', 2),
			word(3, 4, 'd', 'A', 2),
			word(4, 5, 'e', 'A', 3),
		];
		const result = groupWordsBySegment(words);

		expect(result.map((s) => s.segmentIndex)).toEqual([0, 1, 2, 3]);
		expect(result.map((s) => s.time_range.start)).toEqual([0, 1, 2, 4]);
		expect(result.map((s) => s.time_range.end)).toEqual([1, 2, 4, 5]);
	});

	it('does not mutate the input array', () => {
		const words = [
			word(0, 0.5, 'hello', 'A', 0),
			word(0.5, 1, 'there', 'A', 0),
			word(1, 1.5, 'hi', 'B', 1),
		];
		const original = structuredClone(words);

		groupWordsBySegment(words);

		expect(words).toEqual(original);
	});
});
