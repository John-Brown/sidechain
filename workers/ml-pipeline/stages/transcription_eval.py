"""A/B comparison between baseline and WhisperX transcription outputs.

Standalone evaluation script (not a Modal endpoint). Compares two
speech_transcription.json files and computes:
- WER (word error rate) via jiwer
- Timestamp delta statistics (mean/median absolute difference)
- Word count alignment (1:1 match rate)
- Speaker label plausibility (if diarization present)

Usage:
    python -m stages.transcription_eval \
        --baseline s3://bucket/results/{vid}/speech_transcription.json \
        --candidate s3://bucket/results/{vid}/speech_transcription_whisperx.json \
        [--output s3://bucket/results/{vid}/transcription_comparison.json]
        [--local]  # use local files instead of S3
"""

from __future__ import annotations

import argparse
import json
import logging
import statistics
import sys
from collections import Counter
from pathlib import Path

logger = logging.getLogger(__name__)


def load_transcription(path: str, local: bool = False) -> dict:
    """Load a transcription result from S3 or local file."""
    if local:
        with open(path) as f:
            return json.load(f)
    else:
        from .utils import download_json_from_s3
        return download_json_from_s3(path)


def extract_words(result: dict) -> list[dict]:
    """Extract word entries from a TranscriptionResult."""
    return result.get("data", [])


def compute_wer(baseline_words: list[dict], candidate_words: list[dict]) -> dict:
    """Compute word error rate between baseline and candidate transcriptions."""
    try:
        from jiwer import wer, cer
    except ImportError:
        logger.warning("jiwer not installed — skipping WER computation")
        return {"error": "jiwer not installed"}

    baseline_text = " ".join(w["speech"]["word"] for w in baseline_words)
    candidate_text = " ".join(w["speech"]["word"] for w in candidate_words)

    if not baseline_text.strip():
        return {"error": "baseline has no words"}

    word_error_rate = wer(baseline_text, candidate_text)
    char_error_rate = cer(baseline_text, candidate_text)

    return {
        "wer": round(word_error_rate, 4),
        "cer": round(char_error_rate, 4),
        "baseline_word_count": len(baseline_words),
        "candidate_word_count": len(candidate_words),
        "baseline_text_preview": baseline_text[:200],
        "candidate_text_preview": candidate_text[:200],
    }


def compute_timestamp_delta(
    baseline_words: list[dict],
    candidate_words: list[dict],
) -> dict:
    """Compare word timestamps between baseline and candidate.

    Aligns words by normalized text match (case-insensitive, stripped),
    then computes absolute differences in start and end times.
    """
    # Build lookup: normalized_word -> list of (start, end) from baseline
    baseline_by_word: dict[str, list[tuple[float, float]]] = {}
    for w in baseline_words:
        key = w["speech"]["word"].lower().strip()
        tr = w["time_range"]
        baseline_by_word.setdefault(key, []).append((tr["start"], tr["end"]))

    start_deltas: list[float] = []
    end_deltas: list[float] = []
    matched = 0
    unmatched = 0

    # Consume baseline entries in order to avoid double-matching
    baseline_consumed: dict[str, int] = {}

    for w in candidate_words:
        key = w["speech"]["word"].lower().strip()
        entries = baseline_by_word.get(key, [])
        idx = baseline_consumed.get(key, 0)

        if idx < len(entries):
            b_start, b_end = entries[idx]
            c_start = w["time_range"]["start"]
            c_end = w["time_range"]["end"]

            start_deltas.append(abs(c_start - b_start))
            end_deltas.append(abs(c_end - b_end))
            matched += 1
            baseline_consumed[key] = idx + 1
        else:
            unmatched += 1

    if not start_deltas:
        return {
            "error": "no matched words for timestamp comparison",
            "matched": 0,
            "unmatched": unmatched,
        }

    return {
        "matched_words": matched,
        "unmatched_words": unmatched,
        "match_rate": round(matched / (matched + unmatched), 4),
        "start_delta": {
            "mean": round(statistics.mean(start_deltas), 4),
            "median": round(statistics.median(start_deltas), 4),
            "p90": round(sorted(start_deltas)[int(len(start_deltas) * 0.9)], 4),
            "max": round(max(start_deltas), 4),
        },
        "end_delta": {
            "mean": round(statistics.mean(end_deltas), 4),
            "median": round(statistics.median(end_deltas), 4),
            "p90": round(sorted(end_deltas)[int(len(end_deltas) * 0.9)], 4),
            "max": round(max(end_deltas), 4),
        },
    }


def analyze_speakers(words: list[dict]) -> dict:
    """Analyze speaker label distribution and turn patterns."""
    speakers: Counter[str] = Counter()
    turns = 0
    prev_speaker = None

    for w in words:
        speaker = w["speech"].get("speaker", "unknown")
        speakers[speaker] += 1
        if speaker != prev_speaker:
            turns += 1
            prev_speaker = speaker

    unique_speakers = [s for s in speakers if s != "unknown"]
    unknown_count = speakers.get("unknown", 0)
    total = sum(speakers.values())

    return {
        "unique_speakers": len(unique_speakers),
        "speaker_labels": dict(speakers.most_common()),
        "turn_count": turns,
        "unknown_ratio": round(unknown_count / total, 4) if total > 0 else 1.0,
        "has_diarization": len(unique_speakers) > 0 and unknown_count < total * 0.5,
    }


def compare(
    baseline_path: str,
    candidate_path: str,
    local: bool = False,
) -> dict:
    """Run full A/B comparison between baseline and candidate transcriptions."""
    baseline = load_transcription(baseline_path, local=local)
    candidate = load_transcription(candidate_path, local=local)

    baseline_words = extract_words(baseline)
    candidate_words = extract_words(candidate)

    baseline_meta = baseline.get("metadata", {})
    candidate_meta = candidate.get("metadata", {})

    return {
        "baseline": {
            "path": baseline_path,
            "algorithm": baseline_meta.get("algorithm", {}),
            "word_count": len(baseline_words),
            "total_secs": baseline_meta.get("total_secs"),
        },
        "candidate": {
            "path": candidate_path,
            "algorithm": candidate_meta.get("algorithm", {}),
            "word_count": len(candidate_words),
            "total_secs": candidate_meta.get("total_secs"),
        },
        "wer": compute_wer(baseline_words, candidate_words),
        "timestamps": compute_timestamp_delta(baseline_words, candidate_words),
        "baseline_speakers": analyze_speakers(baseline_words),
        "candidate_speakers": analyze_speakers(candidate_words),
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    parser = argparse.ArgumentParser(
        description="Compare baseline vs WhisperX transcription outputs"
    )
    parser.add_argument("--baseline", required=True, help="Path/S3 key for baseline transcription JSON")
    parser.add_argument("--candidate", required=True, help="Path/S3 key for candidate transcription JSON")
    parser.add_argument("--output", help="Path/S3 key to write comparison JSON (optional)")
    parser.add_argument("--local", action="store_true", help="Use local file paths instead of S3 keys")
    args = parser.parse_args()

    result = compare(args.baseline, args.candidate, local=args.local)

    if args.output:
        if args.local:
            Path(args.output).write_text(json.dumps(result, indent=2))
            logger.info("Comparison written to %s", args.output)
        else:
            from .utils import upload_json_to_s3
            upload_json_to_s3(result, args.output)
            logger.info("Comparison uploaded to S3: %s", args.output)
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
