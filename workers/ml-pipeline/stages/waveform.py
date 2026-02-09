"""Waveform peak extraction stage.

Extracts audio from video via ffmpeg, computes peak amplitudes at 200 peaks/sec
using numpy. Supports mono and stereo. Result is a compact JSON (~50KB typical)
suitable for timeline visualization.
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import soundfile as sf

from stages.utils import download_from_s3, upload_json_to_s3

logger = logging.getLogger(__name__)

PEAKS_PER_SECOND = 200


@dataclass
class WaveformResult:
    peaks_l: list[float]
    peaks_r: list[float] | None
    sample_rate: int
    max_peak: float
    duration: float
    processing_time: float
    source_file: str


def _extract_audio(video_path: Path, wav_path: Path, sample_rate: int = 16000) -> None:
    """Extract audio from video using ffmpeg. Preserves channel count."""
    subprocess.run(
        [
            "ffmpeg", "-i", str(video_path),
            "-vn", "-acodec", "pcm_s16le",
            "-ar", str(sample_rate),
            "-y", str(wav_path),
        ],
        capture_output=True,
        check=True,
    )


def _compute_peaks(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Compute peak amplitudes by reshaping into windows and taking max(abs)."""
    samples_per_peak = sample_rate // PEAKS_PER_SECOND
    # Trim to exact multiple of window size
    n_peaks = len(samples) // samples_per_peak
    trimmed = samples[: n_peaks * samples_per_peak]
    windows = trimmed.reshape(n_peaks, samples_per_peak)
    return np.abs(windows).max(axis=1)


def run_waveform(s3_key: str, result_s3_key: str) -> WaveformResult:
    """Download video, extract audio, compute peaks, upload result."""
    t0 = time.monotonic()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        video_path = tmp / "video.mp4"
        wav_path = tmp / "audio.wav"

        # Download video from S3
        download_from_s3(s3_key, video_path)

        # Extract audio (16kHz, preserve channels)
        _extract_audio(video_path, wav_path)

        # Read audio
        data, sr = sf.read(str(wav_path), dtype="float32")
        logger.info("Audio: shape=%s, sr=%d", data.shape, sr)

        # Compute peaks per channel
        if data.ndim == 2:
            # Stereo (or multi-channel — take first two)
            peaks_l = _compute_peaks(data[:, 0], sr)
            peaks_r = _compute_peaks(data[:, 1], sr)
        else:
            # Mono
            peaks_l = _compute_peaks(data, sr)
            peaks_r = None

        # Global max for normalization
        max_peak = float(peaks_l.max())
        if peaks_r is not None:
            max_peak = max(max_peak, float(peaks_r.max()))
        max_peak = max_peak or 1.0

        duration = len(data) / sr if data.ndim == 1 else len(data) / sr

        processing_time = time.monotonic() - t0

        result = WaveformResult(
            peaks_l=peaks_l.tolist(),
            peaks_r=peaks_r.tolist() if peaks_r is not None else None,
            sample_rate=PEAKS_PER_SECOND,
            max_peak=max_peak,
            duration=duration,
            processing_time=processing_time,
            source_file=s3_key,
        )

        # Build output JSON
        output = {
            "metadata": {
                "source_file": s3_key,
                "format_version": "1.0",
                "created_timestamp": datetime.now(timezone.utc).isoformat(),
                "total_secs": duration,
                "algorithm": {
                    "name": "ffmpeg_peaks",
                    "version": "1.0",
                    "processing_time": processing_time,
                    "parameters": {
                        "peaks_per_second": PEAKS_PER_SECOND,
                        "audio_sample_rate": sr,
                    },
                },
            },
            "peaks_l": result.peaks_l,
            "peaks_r": result.peaks_r,
            "sample_rate": PEAKS_PER_SECOND,
            "max_peak": max_peak,
            "duration": duration,
        }

        upload_json_to_s3(output, result_s3_key)
        logger.info(
            "Waveform peaks: %d peaks (%.1fs), max=%.4f, time=%.1fs",
            len(result.peaks_l), duration, max_peak, processing_time,
        )

        return result
