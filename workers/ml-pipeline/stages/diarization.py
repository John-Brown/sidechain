"""Speaker diarization stage using pyannote.audio (pyannote/speaker-diarization-3.1 pipeline)."""

from __future__ import annotations

import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from .utils import download_from_s3, download_json_from_s3, upload_json_to_s3

logger = logging.getLogger(__name__)


def _compute_speaker_timing(segments: list[dict]) -> dict:
    """Compute per-speaker timing metadata from diarization segments."""
    speaker_times: dict[str, list[float]] = {}

    for seg in segments:
        speaker = seg["diarization"]["speaker"]
        duration = seg["time_range"]["end"] - seg["time_range"]["start"]
        if speaker not in speaker_times:
            speaker_times[speaker] = []
        speaker_times[speaker].append(duration)

    metadata = {}
    for speaker, durations in speaker_times.items():
        metadata[speaker] = {
            "total_duration_secs": round(sum(durations), 3),
            "turn_count": len(durations),
            "avg_turn_duration_secs": round(sum(durations) / len(durations), 3),
        }

    return metadata


def _estimate_visible_speaker_probability(
    diarization_segments: list[dict],
    mouth_energy_data: list[dict],
) -> dict[str, float | None]:
    """Estimate probability each speaker is the visible person using mouth energy correlation.

    For each speaker's speaking segments, measure average mouth energy during those times.
    Higher mouth energy during a speaker's turns suggests they are the visible person.
    """
    if not mouth_energy_data or not diarization_segments:
        return {}

    # Build a time-indexed mouth energy lookup (10Hz)
    energy_by_time: dict[float, float] = {}
    for entry in mouth_energy_data:
        start = entry["time_range"]["start"]
        energy_by_time[start] = entry["mouth_energy"]["mouth_energy"]

    # For each speaker, compute average mouth energy during their turns
    speakers: set[str] = set()
    for seg in diarization_segments:
        speakers.add(seg["diarization"]["speaker"])

    speaker_energy: dict[str, list[float]] = {s: [] for s in speakers}

    for seg in diarization_segments:
        speaker = seg["diarization"]["speaker"]
        seg_start = seg["time_range"]["start"]
        seg_end = seg["time_range"]["end"]

        for t, energy in energy_by_time.items():
            if seg_start <= t < seg_end:
                speaker_energy[speaker].append(energy)

    result: dict[str, float | None] = {}
    for speaker, energies in speaker_energy.items():
        if energies:
            result[speaker] = round(sum(energies) / len(energies), 4)
        else:
            result[speaker] = None

    return result


def run_diarization(
    s3_key: str,
    vad_s3_key: str,
    mouth_energy_s3_key: str,
    result_s3_key: str,
) -> dict:
    """Run pyannote speaker diarization, enriched with VAD + mouth energy data.

    Output shape matches DiarizationResult from annotation-types.ts.
    """
    from pyannote.audio import Pipeline

    t0 = time.monotonic()

    hf_token = os.environ.get("HF_TOKEN", "")
    if not hf_token:
        raise RuntimeError("HF_TOKEN environment variable required for pyannote models")

    # Load auxiliary data
    try:
        vad_data = download_json_from_s3(vad_s3_key)
    except Exception as e:
        raise RuntimeError(f"Failed to download VAD data: {e}") from e

    try:
        mouth_energy_data = download_json_from_s3(mouth_energy_s3_key)
    except Exception as e:
        logger.warning("Could not load mouth energy data: %s", e)
        mouth_energy_data = {"data": []}

    source_file = vad_data.get("metadata", {}).get("source_file", s3_key)
    total_secs = vad_data.get("metadata", {}).get("total_secs", 0.0)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # Download source video for audio extraction
        source_ext = Path(s3_key).suffix or ".mp4"
        local_source = tmp_path / f"source{source_ext}"
        try:
            download_from_s3(s3_key, local_source)
        except Exception as e:
            raise RuntimeError(f"Failed to download source from S3: {e}") from e

        # Run pyannote diarization pipeline
        logger.info("Loading pyannote diarization pipeline...")
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=hf_token,
        )

        import torch
        if torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))
            logger.info("Pipeline moved to GPU")

        logger.info("Running diarization...")
        diarization_output = pipeline(str(local_source))

        # Convert pyannote output to our format
        segments: list[dict] = []
        for turn, _, speaker in diarization_output.itertracks(yield_label=True):
            segments.append({
                "time_range": {
                    "start": round(turn.start, 3),
                    "end": round(turn.end, 3),
                },
                "diarization": {
                    "speaker": speaker,
                },
            })

        # Sort by start time
        segments.sort(key=lambda s: s["time_range"]["start"])

        detected_speakers = len(set(
            s["diarization"]["speaker"] for s in segments
        ))

        # Compute enrichment metadata
        speaker_timing = _compute_speaker_timing(segments)
        visible_prob = _estimate_visible_speaker_probability(
            segments, mouth_energy_data.get("data", [])
        )

        processing_time = time.monotonic() - t0

        result = {
            "metadata": {
                "source_file": source_file,
                "format_version": "1.0",
                "created_timestamp": datetime.now(timezone.utc).isoformat(),
                "total_secs": round(total_secs, 3),
                "algorithm": {
                    "name": "pyannote-diarization",
                    "model": "speaker-diarization-3.1",
                    "version": "3.1",
                    "processing_time": round(processing_time, 3),
                },
                "requested_speakers": None,
                "detected_speakers": detected_speakers,
                "visible_speaker_probability": visible_prob,
                "visible_speaker_detection_status": (
                    "estimated" if visible_prob else "unavailable"
                ),
                "audio_channel_speaker_probability": {},
                "audio_channel_detection_status": "not_applicable",
                "speaker_timing_metadata": speaker_timing,
            },
            "data": segments,
        }

        try:
            upload_json_to_s3(result, result_s3_key)
        except Exception as e:
            raise RuntimeError(f"Failed to upload result to S3: {e}") from e

        logger.info(
            "Diarization complete: %d segments, %d speakers in %.1fs",
            len(segments),
            detected_speakers,
            processing_time,
        )

        return result
