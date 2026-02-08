"""Core VAD processing stage using Silero VAD v5."""

from __future__ import annotations

import json
import logging
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import boto3
import torch
import torchaudio

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
WINDOW_SIZE_SAMPLES = 1600  # 100ms at 16kHz -> 10Hz resolution
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
class VadMetadata:
    model: str = "silero-vad-v5"
    sample_rate: int = SAMPLE_RATE
    frame_size_ms: int = 100
    merge_gap_ms: int = MERGE_GAP_MS
    total_segments: int = 0
    speech_ratio: float = 0.0


@dataclass
class VadResult:
    segments: list[VadSegment] = field(default_factory=list)
    metadata: VadMetadata = field(default_factory=VadMetadata)


def _get_s3_client() -> boto3.client:
    import os

    return boto3.client(
        "s3",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
    )


def _get_bucket() -> str:
    import os

    return os.environ["S3_BUCKET"]


def _download_from_s3(s3_key: str, local_path: Path) -> None:
    client = _get_s3_client()
    bucket = _get_bucket()
    logger.info("Downloading s3://%s/%s -> %s", bucket, s3_key, local_path)
    client.download_file(bucket, s3_key, str(local_path))


def _upload_to_s3(local_path: Path, s3_key: str) -> None:
    client = _get_s3_client()
    bucket = _get_bucket()
    logger.info("Uploading %s -> s3://%s/%s", local_path, bucket, s3_key)
    client.upload_file(
        str(local_path),
        bucket,
        s3_key,
        ExtraArgs={"ContentType": "application/json"},
    )


def _load_audio(path: Path) -> torch.Tensor:
    """Load audio file, convert to 16kHz mono."""
    waveform, sr = torchaudio.load(str(path))

    # Mix to mono if stereo
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    # Resample if needed
    if sr != SAMPLE_RATE:
        resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=SAMPLE_RATE)
        waveform = resampler(waveform)

    return waveform.squeeze(0)


def _merge_segments(
    timestamps: list[dict], total_samples: int
) -> list[VadSegment]:
    """Merge speech timestamps within MERGE_GAP_MS and convert to VadSegments."""
    if not timestamps:
        return []

    merged: list[VadSegment] = []

    current_start = timestamps[0]["start"]
    current_end = timestamps[0]["end"]
    # Silero returns probabilities per-chunk — average them for merged segments
    confidences = [timestamps[0].get("confidence", 1.0)]

    for ts in timestamps[1:]:
        gap_samples = ts["start"] - current_end
        if gap_samples <= MERGE_GAP_SAMPLES:
            # Extend current segment
            current_end = ts["end"]
            confidences.append(ts.get("confidence", 1.0))
        else:
            # Finalize current segment
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

    # Finalize last segment
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


def _run_silero_vad(waveform: torch.Tensor) -> list[VadSegment]:
    """Run Silero VAD on waveform, return merged speech segments."""
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

    return _merge_segments(timestamps, len(waveform))


def _compute_speech_ratio(segments: list[VadSegment], total_duration: float) -> float:
    if total_duration <= 0:
        return 0.0
    speech_duration = sum(s.time_range.end - s.time_range.start for s in segments)
    return round(speech_duration / total_duration, 3)


def _result_to_dict(result: VadResult) -> dict:
    return {
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
        "metadata": {
            "model": result.metadata.model,
            "sample_rate": result.metadata.sample_rate,
            "frame_size_ms": result.metadata.frame_size_ms,
            "merge_gap_ms": result.metadata.merge_gap_ms,
            "total_segments": result.metadata.total_segments,
            "speech_ratio": result.metadata.speech_ratio,
        },
    }


def run_vad(s3_key: str, result_s3_key: str) -> VadResult:
    """Download video from S3, run Silero VAD, upload results, return VadResult."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # Download source file
        source_ext = Path(s3_key).suffix or ".mp4"
        local_source = tmp_path / f"source{source_ext}"
        try:
            _download_from_s3(s3_key, local_source)
        except Exception as e:
            raise RuntimeError(f"Failed to download source from S3: {e}") from e

        # Load and prepare audio
        try:
            waveform = _load_audio(local_source)
        except Exception as e:
            raise RuntimeError(f"Failed to decode audio: {e}") from e

        total_duration = len(waveform) / SAMPLE_RATE
        logger.info(
            "Audio loaded: %.1fs, %d samples", total_duration, len(waveform)
        )

        # Run VAD
        try:
            segments = _run_silero_vad(waveform)
        except Exception as e:
            raise RuntimeError(f"VAD inference failed: {e}") from e

        speech_ratio = _compute_speech_ratio(segments, total_duration)

        result = VadResult(
            segments=segments,
            metadata=VadMetadata(
                total_segments=len(segments),
                speech_ratio=speech_ratio,
            ),
        )

        # Serialize and upload
        result_json = json.dumps(_result_to_dict(result), indent=2)
        result_file = tmp_path / "vad_result.json"
        result_file.write_text(result_json)

        try:
            _upload_to_s3(result_file, result_s3_key)
        except Exception as e:
            raise RuntimeError(f"Failed to upload result to S3: {e}") from e

        logger.info(
            "VAD complete: %d segments, speech_ratio=%.3f",
            len(segments),
            speech_ratio,
        )

        return result
