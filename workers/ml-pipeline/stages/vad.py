"""Core VAD processing stage using Silero VAD v5."""

from __future__ import annotations

import json
import logging
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import torch

from .utils import download_from_s3, load_audio, upload_to_s3

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
WINDOW_SIZE_SAMPLES = 512  # 32ms at 16kHz (Silero VAD v5 requirement)
MERGE_GAP_MS = 300
MERGE_GAP_SAMPLES = int(MERGE_GAP_MS / 1000 * SAMPLE_RATE)
VAD_THRESHOLD = 0.5


@dataclass
class TimeRange:
    start: float
    end: float


@dataclass
class VadSegment:
    time_range: TimeRange
    confidence: float


@dataclass
class VadFrame:
    time_range: TimeRange
    speech_probability: float


@dataclass
class VadMetadata:
    model: str = "silero-vad-v5"
    sample_rate: int = SAMPLE_RATE
    frame_size_ms: int = 32
    merge_gap_ms: int = MERGE_GAP_MS
    total_segments: int = 0
    speech_ratio: float = 0.0


@dataclass
class VadResult:
    segments: list[VadSegment] = field(default_factory=list)
    frames: list[VadFrame] = field(default_factory=list)
    metadata: VadMetadata = field(default_factory=VadMetadata)


def _merge_segments(
    timestamps: list[dict], total_samples: int
) -> list[VadSegment]:
    """Merge speech timestamps within MERGE_GAP_MS and convert to VadSegments."""
    if not timestamps:
        return []

    merged: list[VadSegment] = []

    current_start = timestamps[0]["start"]
    current_end = timestamps[0]["end"]
    confidences = [timestamps[0].get("confidence", 1.0)]

    for ts in timestamps[1:]:
        gap_samples = ts["start"] - current_end
        if gap_samples <= MERGE_GAP_SAMPLES:
            current_end = ts["end"]
            confidences.append(ts.get("confidence", 1.0))
        else:
            merged.append(
                VadSegment(
                    time_range=TimeRange(
                        start=round(current_start / SAMPLE_RATE, 3),
                        end=round(current_end / SAMPLE_RATE, 3),
                    ),
                    confidence=round(sum(confidences) / len(confidences), 3),
                )
            )
            current_start = ts["start"]
            current_end = ts["end"]
            confidences = [ts.get("confidence", 1.0)]

    merged.append(
        VadSegment(
            time_range=TimeRange(
                start=round(current_start / SAMPLE_RATE, 3),
                end=round(current_end / SAMPLE_RATE, 3),
            ),
            confidence=round(sum(confidences) / len(confidences), 3),
        )
    )

    return merged


def _run_silero_vad(waveform: torch.Tensor) -> tuple[list[VadSegment], list[VadFrame]]:
    """Run Silero VAD on waveform. Returns (merged segments, per-window frames at 10Hz)."""
    model, utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        trust_repo=True,
    )
    get_speech_timestamps = utils[0]

    timestamps = get_speech_timestamps(
        waveform,
        model,
        sampling_rate=SAMPLE_RATE,
        window_size_samples=WINDOW_SIZE_SAMPLES,
        threshold=VAD_THRESHOLD,
        return_seconds=False,
    )

    segments = _merge_segments(timestamps, len(waveform))

    # Compute per-window speech probabilities at 10Hz (100ms windows)
    frames: list[VadFrame] = []
    model.reset_states()
    num_windows = len(waveform) // WINDOW_SIZE_SAMPLES
    for i in range(num_windows):
        chunk = waveform[i * WINDOW_SIZE_SAMPLES : (i + 1) * WINDOW_SIZE_SAMPLES]
        prob = model(chunk.unsqueeze(0), SAMPLE_RATE).item()
        start_sec = round(i * WINDOW_SIZE_SAMPLES / SAMPLE_RATE, 3)
        end_sec = round((i + 1) * WINDOW_SIZE_SAMPLES / SAMPLE_RATE, 3)
        frames.append(
            VadFrame(
                time_range=TimeRange(start=start_sec, end=end_sec),
                speech_probability=round(prob, 4),
            )
        )

    return segments, frames


def _compute_speech_ratio(segments: list[VadSegment], total_duration: float) -> float:
    if total_duration <= 0:
        return 0.0
    speech_duration = sum(s.time_range.end - s.time_range.start for s in segments)
    return round(speech_duration / total_duration, 3)


def _result_to_dict(result: VadResult, source_file: str, total_duration: float, processing_time: float) -> dict:
    return {
        "metadata": {
            "source_file": source_file,
            "format_version": "1.0",
            "created_timestamp": datetime.now(timezone.utc).isoformat(),
            "total_secs": round(total_duration, 3),
            "algorithm": {
                "name": "silero-vad",
                "model": result.metadata.model,
                "version": "v5",
                "processing_time": round(processing_time, 3),
                "window_size_ms": result.metadata.frame_size_ms,
                "hop_size_ms": result.metadata.frame_size_ms,
                "sample_rate": result.metadata.sample_rate,
                "threshold": VAD_THRESHOLD,
                "parameters": {
                    "merge_gap_ms": result.metadata.merge_gap_ms,
                },
            },
            "total_segments": result.metadata.total_segments,
            "speech_ratio": result.metadata.speech_ratio,
        },
        "segments": [
            {
                "time_range": {
                    "start": seg.time_range.start,
                    "end": seg.time_range.end,
                },
                "confidence": seg.confidence,
            }
            for seg in result.segments
        ],
        "frames": [
            {
                "time_range": {
                    "start": frame.time_range.start,
                    "end": frame.time_range.end,
                },
                "speech_probability": frame.speech_probability,
            }
            for frame in result.frames
        ],
    }


def run_vad(s3_key: str, result_s3_key: str) -> VadResult:
    """Download video from S3, run Silero VAD, upload results, return VadResult."""
    t0 = time.monotonic()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # Download source file
        source_ext = Path(s3_key).suffix or ".mp4"
        local_source = tmp_path / f"source{source_ext}"
        try:
            download_from_s3(s3_key, local_source)
        except Exception as e:
            raise RuntimeError(f"Failed to download source from S3: {e}") from e

        # Load and prepare audio
        try:
            waveform = load_audio(local_source)
        except Exception as e:
            raise RuntimeError(f"Failed to decode audio: {e}") from e

        total_duration = len(waveform) / SAMPLE_RATE
        logger.info(
            "Audio loaded: %.1fs, %d samples", total_duration, len(waveform)
        )

        # Run VAD
        try:
            segments, frames = _run_silero_vad(waveform)
        except Exception as e:
            raise RuntimeError(f"VAD inference failed: {e}") from e

        speech_ratio = _compute_speech_ratio(segments, total_duration)
        processing_time = time.monotonic() - t0

        result = VadResult(
            segments=segments,
            frames=frames,
            metadata=VadMetadata(
                total_segments=len(segments),
                speech_ratio=speech_ratio,
            ),
        )

        # Serialize and upload
        result_dict = _result_to_dict(result, s3_key, total_duration, processing_time)
        result_json = json.dumps(result_dict, indent=2)
        result_file = tmp_path / "vad_result.json"
        result_file.write_text(result_json)

        try:
            upload_to_s3(result_file, result_s3_key)
        except Exception as e:
            raise RuntimeError(f"Failed to upload result to S3: {e}") from e

        logger.info(
            "VAD complete: %d segments, %d frames, speech_ratio=%.3f",
            len(segments),
            len(frames),
            speech_ratio,
        )

        return result
