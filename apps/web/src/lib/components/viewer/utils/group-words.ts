import type { SpeechWord, TimeRange } from '@annotation/shared';

export interface TranscriptionSegment {
	time_range: TimeRange;
	text: string;
	speaker: string;
	wordCount: number;
	segmentIndex: number;
}

/**
 * Groups words by their speech_segment index into phrase-level blocks.
 * Used for LOD rendering — segments replace individual words when zoomed out.
 */
export function groupWordsBySegment(words: SpeechWord[]): TranscriptionSegment[] {
	if (words.length === 0) return [];

	const segments: TranscriptionSegment[] = [];
	let groupStart = 0;

	for (let i = 1; i <= words.length; i++) {
		const prev = words[i - 1];
		const curr = i < words.length ? words[i] : null;

		if (!curr || curr.speech.speech_segment !== prev.speech.speech_segment) {
			// Flush group [groupStart, i)
			const group = words.slice(groupStart, i);
			const text = group.map((w) => w.speech.word).join(' ');

			// Majority speaker
			const speakerCounts = new Map<string, number>();
			for (const w of group) {
				speakerCounts.set(w.speech.speaker, (speakerCounts.get(w.speech.speaker) ?? 0) + 1);
			}
			let speaker = group[0].speech.speaker;
			let maxCount = 0;
			for (const [s, count] of speakerCounts) {
				if (count > maxCount) {
					speaker = s;
					maxCount = count;
				}
			}

			segments.push({
				time_range: {
					start: group[0].time_range.start,
					end: group[group.length - 1].time_range.end,
				},
				text: text.length > 80 ? text.slice(0, 77) + '...' : text,
				speaker,
				wordCount: group.length,
				segmentIndex: prev.speech.speech_segment,
			});

			groupStart = i;
		}
	}

	return segments;
}
