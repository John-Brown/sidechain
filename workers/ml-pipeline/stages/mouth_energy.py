"""Mouth energy computation from facial tracking blend shapes."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from .utils import download_json_from_s3, upload_json_to_s3

logger = logging.getLogger(__name__)

# Blend shape weights for mouth energy computation
# Index into the 52 ARKit blend shapes array (see facial_tracking.py BLEND_SHAPE_NAMES)
MOUTH_BLEND_SHAPE_WEIGHTS: dict[str, tuple[int, float]] = {
    "jawOpen": (24, 0.25),
    "mouthSmileLeft": (43, 0.10),
    "mouthSmileRight": (44, 0.10),
    "mouthDimpleLeft": (27, 0.08),
    "mouthDimpleRight": (28, 0.08),
    "mouthPucker": (37, 0.08),
    "mouthPressLeft": (35, 0.08),
    "mouthPressRight": (36, 0.08),
    "mouthStretchLeft": (45, 0.075),
    "mouthStretchRight": (46, 0.075),
}

# Target output rate: 10Hz (100ms windows)
WINDOW_MS = 100


def _compute_frame_energy(blendshapes: list[float]) -> dict:
    """Compute mouth energy for a single frame from its blend shape values.

    Returns per-shape breakdown and total weighted energy.
    """
    per_shape: dict[str, dict] = {}
    total_energy = 0.0

    for name, (idx, weight) in MOUTH_BLEND_SHAPE_WEIGHTS.items():
        raw_value = blendshapes[idx] if idx < len(blendshapes) else 0.0
        weighted = raw_value * weight
        total_energy += weighted
        per_shape[name] = {
            "raw_value": round(raw_value, 4),
            "deviation": round(weighted, 4),
        }

    return {
        "blend_shape_energy": per_shape,
        "mouth_energy": round(total_energy, 4),
    }


def run_mouth_energy(facial_tracking_s3_key: str, result_s3_key: str) -> dict:
    """Read facial tracking JSON, compute mouth energy at 10Hz, upload result.

    Output shape matches MouthEnergyResult from annotation-types.ts.
    """
    t0 = time.monotonic()

    # Load facial tracking data
    try:
        tracking_data = download_json_from_s3(facial_tracking_s3_key)
    except Exception as e:
        raise RuntimeError(f"Failed to download facial tracking data: {e}") from e

    frames = tracking_data.get("data", [])
    source_file = tracking_data.get("metadata", {}).get("source_file", "")
    total_secs = tracking_data.get("metadata", {}).get("total_secs", 0.0)

    if not frames:
        logger.warning("No facial tracking frames found")

    # Group frames into 100ms windows and average
    window_sec = WINDOW_MS / 1000.0
    windows_data: list[dict] = []

    if frames:
        max_time = frames[-1]["time"]
        num_windows = int(max_time / window_sec) + 1

        for w in range(num_windows):
            window_start = round(w * window_sec, 3)
            window_end = round((w + 1) * window_sec, 3)

            # Collect frames within this window
            window_frames = [
                f for f in frames
                if window_start <= f["time"] < window_end
            ]

            if not window_frames:
                # No face data in this window — zero energy
                per_shape = {}
                for name, (idx, weight) in MOUTH_BLEND_SHAPE_WEIGHTS.items():
                    per_shape[name] = {"raw_value": 0.0, "deviation": 0.0}
                windows_data.append({
                    "time_range": {"start": window_start, "end": window_end},
                    "mouth_energy": {
                        "blend_shape_energy": per_shape,
                        "mouth_energy": 0.0,
                    },
                })
                continue

            # Average blend shapes across frames in window
            n = len(window_frames)
            avg_blendshapes = [0.0] * 52
            for f in window_frames:
                bs = f["facial_tracking"]["tracking"]["blendshapes"]
                for i in range(min(len(bs), 52)):
                    avg_blendshapes[i] += bs[i]
            avg_blendshapes = [v / n for v in avg_blendshapes]

            energy = _compute_frame_energy(avg_blendshapes)
            windows_data.append({
                "time_range": {"start": window_start, "end": window_end},
                "mouth_energy": energy,
            })

    processing_time = time.monotonic() - t0

    result = {
        "metadata": {
            "source_file": source_file,
            "format_version": "1.0",
            "created_timestamp": datetime.now(timezone.utc).isoformat(),
            "total_secs": round(total_secs, 3),
            "algorithm": {
                "name": "mouth-energy",
                "version": "1.0",
                "processing_time": round(processing_time, 3),
                "parameters": {
                    "window_ms": WINDOW_MS,
                    "blend_shape_weights": {
                        name: weight for name, (_, weight) in MOUTH_BLEND_SHAPE_WEIGHTS.items()
                    },
                },
            },
        },
        "data": windows_data,
    }

    try:
        upload_json_to_s3(result, result_s3_key)
    except Exception as e:
        raise RuntimeError(f"Failed to upload result to S3: {e}") from e

    logger.info(
        "Mouth energy complete: %d windows in %.1fs",
        len(windows_data),
        processing_time,
    )

    return result
