"""Compare transcription word timestamps against VAD speech segments.

Pulls both results from S3 for a given video and reports:
- Words inside/outside VAD segments
- Timing gaps between word onsets and nearest VAD boundary
- VAD segments with/without words (missed speech?)
- First/last word vs first/last VAD segment timing

Usage:
    # Via S3 (needs AWS env vars)
    uv run python -m stages.vad_transcript_align --video-id <VIDEO_ID>

    # Via local files
    uv run python -m stages.vad_transcript_align \
        --vad path/to/voice_activity.json \
        --transcript path/to/speech_transcription.json
"""

from __future__ import annotations

import argparse
import json
import logging
import statistics
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def load_json(path: str | None = None, s3_key: str | None = None) -> dict:
    if path:
        with open(path) as f:
            return json.load(f)
    elif s3_key:
        from .utils import download_json_from_s3
        return download_json_from_s3(s3_key)
    raise ValueError("need path or s3_key")


def analyze(vad_data: dict, transcript_data: dict) -> dict:
    """Compare word timestamps against VAD speech segments."""

    vad_segments = [
        (s["time_range"]["start"], s["time_range"]["end"])
        for s in vad_data.get("segments", [])
    ]
    words = transcript_data.get("data", [])

    if not vad_segments:
        return {"error": "no VAD segments found"}
    if not words:
        return {"error": "no transcription words found"}

    total_duration = vad_data.get("metadata", {}).get("total_secs", 0)
    vad_speech_secs = sum(end - start for start, end in vad_segments)

    # --- Per-word analysis: is each word inside a VAD segment? ---
    words_inside = []
    words_outside = []
    word_to_nearest_vad_start: list[float] = []

    for w in words:
        ws = w["time_range"]["start"]
        we = w["time_range"]["end"]
        word_mid = (ws + we) / 2

        inside = any(vs <= word_mid <= ve for vs, ve in vad_segments)
        entry = {
            "word": w["speech"]["word"],
            "start": ws,
            "end": we,
        }

        if inside:
            words_inside.append(entry)
        else:
            # Find nearest VAD segment boundary
            min_dist = min(
                min(abs(ws - vs), abs(ws - ve), abs(we - vs), abs(we - ve))
                for vs, ve in vad_segments
            )
            entry["distance_to_nearest_vad"] = round(min_dist, 4)
            words_outside.append(entry)

        # Distance from word start to nearest VAD segment start
        nearest_seg_start = min(abs(ws - vs) for vs, _ in vad_segments)
        word_to_nearest_vad_start.append(nearest_seg_start)

    # --- Per-VAD-segment analysis: which segments have words? ---
    segments_with_words = []
    segments_without_words = []

    for vs, ve in vad_segments:
        seg_words = [
            w for w in words
            if w["time_range"]["start"] >= vs - 0.1
            and w["time_range"]["start"] <= ve + 0.1
        ]
        entry = {"start": vs, "end": ve, "duration": round(ve - vs, 3)}
        if seg_words:
            entry["word_count"] = len(seg_words)
            entry["first_word_offset"] = round(
                seg_words[0]["time_range"]["start"] - vs, 4
            )
            segments_with_words.append(entry)
        else:
            segments_without_words.append(entry)

    # --- Timeline comparison ---
    first_vad = vad_segments[0]
    last_vad = vad_segments[-1]
    first_word = words[0]["time_range"]
    last_word = words[-1]["time_range"]

    # --- Word onset relative to containing VAD segment start ---
    word_offsets_from_seg_start: list[float] = []
    for w in words:
        ws = w["time_range"]["start"]
        for vs, ve in vad_segments:
            if vs - 0.1 <= ws <= ve + 0.1:
                word_offsets_from_seg_start.append(ws - vs)
                break

    def _stats(vals: list[float]) -> dict:
        if not vals:
            return {}
        sorted_v = sorted(vals)
        return {
            "mean": round(statistics.mean(vals), 4),
            "median": round(statistics.median(vals), 4),
            "p10": round(sorted_v[max(0, int(len(vals) * 0.1))], 4),
            "p90": round(sorted_v[min(len(vals) - 1, int(len(vals) * 0.9))], 4),
            "min": round(min(vals), 4),
            "max": round(max(vals), 4),
        }

    return {
        "summary": {
            "total_duration": total_duration,
            "vad_speech_secs": round(vad_speech_secs, 3),
            "vad_segment_count": len(vad_segments),
            "word_count": len(words),
            "words_inside_vad": len(words_inside),
            "words_outside_vad": len(words_outside),
            "coverage_rate": round(len(words_inside) / len(words), 4),
        },
        "timeline": {
            "first_vad_start": first_vad[0],
            "first_word_start": first_word["start"],
            "first_word_vs_vad_delta": round(first_word["start"] - first_vad[0], 4),
            "last_vad_end": last_vad[1],
            "last_word_end": last_word["end"],
            "last_word_vs_vad_delta": round(last_word["end"] - last_vad[1], 4),
        },
        "word_onset_offset_from_vad_segment_start": _stats(word_offsets_from_seg_start),
        "vad_segments_with_words": len(segments_with_words),
        "vad_segments_without_words": {
            "count": len(segments_without_words),
            "segments": segments_without_words[:10],  # cap output
        },
        "words_outside_vad_segments": {
            "count": len(words_outside),
            "first_10": words_outside[:10],
        },
        "outside_word_distance_stats": _stats(
            [w["distance_to_nearest_vad"] for w in words_outside]
        ) if words_outside else {},
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    parser = argparse.ArgumentParser(description="Compare transcription vs VAD alignment")
    parser.add_argument("--video-id", help="Video ID (pulls both results from S3)")
    parser.add_argument("--vad", help="Local path to voice_activity.json")
    parser.add_argument("--transcript", help="Local path to speech_transcription.json")
    args = parser.parse_args()

    if args.video_id:
        vad_key = f"results/{args.video_id}/voice_activity.json"
        tx_key = f"results/{args.video_id}/speech_transcription.json"
        logger.info("Loading from S3: %s, %s", vad_key, tx_key)
        vad_data = load_json(s3_key=vad_key)
        transcript_data = load_json(s3_key=tx_key)
    elif args.vad and args.transcript:
        vad_data = load_json(path=args.vad)
        transcript_data = load_json(path=args.transcript)
    else:
        parser.error("provide --video-id or both --vad and --transcript")
        return

    result = analyze(vad_data, transcript_data)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
