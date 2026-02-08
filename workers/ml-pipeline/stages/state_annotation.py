"""Rule-based state annotation: speaking/listening from diarization segments."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from .utils import download_json_from_s3, upload_json_to_s3

logger = logging.getLogger(__name__)


def run_state_annotation(diarization_s3_key: str, result_s3_key: str) -> dict:
    """Convert diarization segments to speaking/listening state annotations.

    Rules:
    - Diarization speaking segments -> expression.state.speaking
    - Gaps between segments -> expression.state.listening

    Output shape matches StateAnnotationResult from annotation-types.ts.
    """
    t0 = time.monotonic()

    try:
        diarization_data = download_json_from_s3(diarization_s3_key)
    except Exception as e:
        raise RuntimeError(f"Failed to download diarization data: {e}") from e

    segments = diarization_data.get("data", [])
    source_file = diarization_data.get("metadata", {}).get("source_file", "")
    total_secs = diarization_data.get("metadata", {}).get("total_secs", 0.0)

    annotations: list[dict] = []

    if not segments:
        # Entire duration is listening
        if total_secs > 0:
            annotations.append({
                "time_range": {"start": 0.0, "end": round(total_secs, 3)},
                "category": "expression.state.listening",
                "note": "No speech detected",
                "parameters": {},
            })
    else:
        # Sort by start time
        sorted_segments = sorted(segments, key=lambda s: s["time_range"]["start"])

        current_time = 0.0

        for seg in sorted_segments:
            seg_start = seg["time_range"]["start"]
            seg_end = seg["time_range"]["end"]
            speaker = seg["diarization"]["speaker"]

            # Gap before this segment -> listening
            if seg_start > current_time + 0.01:  # Avoid micro-gaps
                annotations.append({
                    "time_range": {
                        "start": round(current_time, 3),
                        "end": round(seg_start, 3),
                    },
                    "category": "expression.state.listening",
                    "note": "",
                    "parameters": {},
                })

            # Speaking segment
            annotations.append({
                "time_range": {
                    "start": round(seg_start, 3),
                    "end": round(seg_end, 3),
                },
                "category": "expression.state.speaking",
                "note": "",
                "parameters": {"speaker": speaker},
            })

            current_time = max(current_time, seg_end)

        # Trailing listening after last segment
        if current_time < total_secs - 0.01:
            annotations.append({
                "time_range": {
                    "start": round(current_time, 3),
                    "end": round(total_secs, 3),
                },
                "category": "expression.state.listening",
                "note": "",
                "parameters": {},
            })

    processing_time = time.monotonic() - t0

    result = {
        "metadata": {
            "source_file": source_file,
            "format_version": "1.0",
            "created_timestamp": datetime.now(timezone.utc).isoformat(),
            "total_secs": round(total_secs, 3),
            "algorithm": {
                "name": "rule-based-state",
                "version": "1.0",
                "processing_time": round(processing_time, 3),
                "parameters": {
                    "min_gap_sec": 0.01,
                },
            },
        },
        "data": annotations,
    }

    try:
        upload_json_to_s3(result, result_s3_key)
    except Exception as e:
        raise RuntimeError(f"Failed to upload result to S3: {e}") from e

    logger.info(
        "State annotation complete: %d annotations (speaking + listening) in %.3fs",
        len(annotations),
        processing_time,
    )

    return result
