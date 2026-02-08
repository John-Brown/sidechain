"""Facial tracking stage using MediaPipe Face Mesh (468 landmarks + blend shapes)."""

from __future__ import annotations

import logging
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from .utils import download_from_s3, upload_json_to_s3

logger = logging.getLogger(__name__)

# MediaPipe blend shape names in canonical order (52 ARKit blend shapes)
BLEND_SHAPE_NAMES = [
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft",
    "browOuterUpRight", "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight",
    "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
    "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft", "jawOpen",
    "jawRight", "mouthClose", "mouthDimpleLeft", "mouthDimpleRight",
    "mouthFrownLeft", "mouthFrownRight", "mouthFunnel", "mouthLeft",
    "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft",
    "mouthPressRight", "mouthPucker", "mouthRight", "mouthRollLower",
    "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft",
    "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
    "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft",
    "noseSneerRight", "tongueOut",
]


def run_facial_tracking(s3_key: str, result_s3_key: str) -> dict:
    """Download video from S3, run MediaPipe Face Mesh per-frame, upload results.

    Output shape matches FacialTrackingResult from annotation-types.ts.
    """
    import mediapipe as mp

    t0 = time.monotonic()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        source_ext = Path(s3_key).suffix or ".mp4"
        local_source = tmp_path / f"source{source_ext}"
        try:
            download_from_s3(s3_key, local_source)
        except Exception as e:
            raise RuntimeError(f"Failed to download source from S3: {e}") from e

        cap = cv2.VideoCapture(str(local_source))
        if not cap.isOpened():
            raise RuntimeError(f"Failed to open video: {local_source}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        total_duration = total_frames / fps if fps > 0 else 0

        logger.info(
            "Video: %dx%d, %.1f fps, %d frames (%.1fs)",
            width, height, fps, total_frames, total_duration,
        )

        mp_face_mesh = mp.solutions.face_mesh
        face_mesh = mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        frames_data: list[dict] = []
        frame_idx = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_time = round(frame_idx / fps, 4)
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb_frame)

            if results.multi_face_landmarks and len(results.multi_face_landmarks) > 0:
                face_landmarks = results.multi_face_landmarks[0]

                # Extract 2D landmarks (normalized to pixel coords)
                landmarks = []
                for lm in face_landmarks.landmark:
                    landmarks.append([round(lm.x * width, 1), round(lm.y * height, 1)])

                # Extract blend shapes if available
                blendshapes = [0.0] * 52
                if (
                    results.multi_face_blendshapes
                    and len(results.multi_face_blendshapes) > 0
                ):
                    for bs in results.multi_face_blendshapes[0]:
                        if bs.category_name in BLEND_SHAPE_NAMES:
                            idx = BLEND_SHAPE_NAMES.index(bs.category_name)
                            blendshapes[idx] = round(bs.score, 4)

                # Approximate head pose from key landmarks (nose tip, chin, eye corners)
                # Using a simple estimation from landmark positions
                nose_tip = face_landmarks.landmark[1]
                rotation = [
                    round((nose_tip.y - 0.5) * 60, 2),  # pitch estimate
                    round((nose_tip.x - 0.5) * -60, 2),  # yaw estimate
                    0.0,  # roll (requires more complex computation)
                ]
                translation = [
                    round(nose_tip.x * width, 1),
                    round(nose_tip.y * height, 1),
                    round(nose_tip.z * width, 1),
                ]

                # Gaze direction approximation from iris landmarks (468-472)
                if len(face_landmarks.landmark) > 472:
                    left_iris = face_landmarks.landmark[468]
                    right_iris = face_landmarks.landmark[473]
                    gaze_x = round((left_iris.x + right_iris.x) / 2 - 0.5, 4)
                    gaze_y = round((left_iris.y + right_iris.y) / 2 - 0.5, 4)
                    gaze_direction = [gaze_x, gaze_y, -1.0]
                else:
                    gaze_direction = [0.0, 0.0, -1.0]

                frames_data.append({
                    "time": frame_time,
                    "facial_tracking": {
                        "tracking": {
                            "blendshapes": blendshapes,
                            "head_pose": {
                                "rotation": rotation,
                                "translation": translation,
                            },
                            "gaze_direction": gaze_direction,
                            "landmarks": landmarks,
                            "confidence": 1.0,
                            "face_detected": True,
                        },
                    },
                })
            else:
                frames_data.append({
                    "time": frame_time,
                    "facial_tracking": {
                        "tracking": {
                            "blendshapes": [0.0] * 52,
                            "head_pose": {
                                "rotation": [0.0, 0.0, 0.0],
                                "translation": [0.0, 0.0, 0.0],
                            },
                            "gaze_direction": [0.0, 0.0, -1.0],
                            "landmarks": [],
                            "confidence": 0.0,
                            "face_detected": False,
                        },
                    },
                })

            frame_idx += 1

        cap.release()
        face_mesh.close()

        processing_time = time.monotonic() - t0

        result = {
            "metadata": {
                "source_file": s3_key,
                "format_version": "1.0",
                "created_timestamp": datetime.now(timezone.utc).isoformat(),
                "total_secs": round(total_duration, 3),
                "algorithm": {
                    "name": "mediapipe-face-mesh",
                    "model": "face_mesh",
                    "version": "0.10",
                    "processing_time": round(processing_time, 3),
                    "parameters": {
                        "max_num_faces": 1,
                        "refine_landmarks": True,
                        "min_detection_confidence": 0.5,
                        "min_tracking_confidence": 0.5,
                    },
                },
                "video_width": width,
                "video_height": height,
            },
            "data": frames_data,
        }

        try:
            upload_json_to_s3(result, result_s3_key)
        except Exception as e:
            raise RuntimeError(f"Failed to upload result to S3: {e}") from e

        logger.info(
            "Facial tracking complete: %d frames processed in %.1fs",
            frame_idx,
            processing_time,
        )

        return result
