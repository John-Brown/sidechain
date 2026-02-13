"""Facial tracking stage using MediaPipe FaceLandmarker (478 landmarks + blend shapes)."""

from __future__ import annotations

import logging
import tempfile
import time
import traceback
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

# Model URL for FaceLandmarker task bundle
_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"


def _download_model(dest: Path) -> Path:
    """Download the FaceLandmarker model if not already present."""
    model_path = dest / "face_landmarker.task"
    if not model_path.exists():
        import urllib.request
        logger.info("Downloading FaceLandmarker model...")
        urllib.request.urlretrieve(_MODEL_URL, str(model_path))
    return model_path


def _get_mesh_topology() -> dict:
    """Return static mesh connectivity (vendored from MediaPipe)."""
    from .face_mesh_topology import get_mesh_topology
    return get_mesh_topology()


def _run_depth_on_keyframes(
    keyframe_buffer: list[tuple[float, np.ndarray, list[tuple[float, float]]]],
    width: int,
    height: int,
) -> list[dict]:
    """Run Depth Anything V2 on buffered keyframes, sample depth at landmark positions."""
    if not keyframe_buffer:
        return []

    from PIL import Image as PILImage
    from transformers import pipeline as hf_pipeline

    depth_pipe = hf_pipeline(task="depth-estimation", model="depth-anything/Depth-Anything-V2-Base-hf", device="cuda")

    mesh_keyframes = []
    # Process in batches of 3000 to stay within memory budget
    BATCH_SIZE = 3000
    for batch_start in range(0, len(keyframe_buffer), BATCH_SIZE):
        batch = keyframe_buffer[batch_start:batch_start + BATCH_SIZE]
        pil_images = [PILImage.fromarray(rgb) for _, rgb, _ in batch]
        depth_results = depth_pipe(pil_images, batch_size=8)

        for (frame_time, _rgb, landmarks_norm), depth_result in zip(batch, depth_results):
            depth_map = np.array(depth_result["depth"])
            dh, dw = depth_map.shape[:2]

            depths = []
            vertices = []
            for lm_x, lm_y in landmarks_norm:
                px = min(int(lm_x * dw), dw - 1)
                py = min(int(lm_y * dh), dh - 1)
                depths.append(round(float(depth_map[py, px]), 3))
                vertices.append([
                    round(lm_x * width, 1),
                    round(lm_y * height, 1),
                    0.0,  # mp_z placeholder — filled from landmarks in main loop
                ])

            mesh_keyframes.append({
                "time": frame_time,
                "vertices": vertices,
                "depth": depths,
                "face_detected": True,
            })

    return mesh_keyframes


def run_facial_tracking(s3_key: str, result_s3_key: str) -> dict:
    """Download video from S3, run MediaPipe FaceLandmarker per-frame, upload results.

    Output shape matches FacialTrackingResult from annotation-types.ts.
    """
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

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

        keyframe_interval = max(1, round(fps / 10))
        keyframe_buffer: list[tuple[float, np.ndarray, list[tuple[float, float]]]] = []

        logger.info(
            "Video: %dx%d, %.1f fps, %d frames (%.1fs)",
            width, height, fps, total_frames, total_duration,
        )

        # Download and configure FaceLandmarker
        model_path = _download_model(tmp_path)

        options = vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
        )

        landmarker = vision.FaceLandmarker.create_from_options(options)

        frames_data: list[dict] = []
        frame_idx = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_time = round(frame_idx / fps, 4)
            timestamp_ms = int(frame_idx * 1000 / fps)

            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            results = landmarker.detect_for_video(mp_image, timestamp_ms)

            if results.face_landmarks and len(results.face_landmarks) > 0:
                face_landmarks = results.face_landmarks[0]

                # Extract 3D landmarks (x, y in pixels; z in MediaPipe depth units)
                landmarks = []
                for lm in face_landmarks:
                    landmarks.append([round(lm.x * width, 1), round(lm.y * height, 1), round(lm.z * width, 3)])

                # Extract blend shapes
                blendshapes = [0.0] * 52
                if results.face_blendshapes and len(results.face_blendshapes) > 0:
                    for bs in results.face_blendshapes[0]:
                        if bs.category_name in BLEND_SHAPE_NAMES:
                            idx = BLEND_SHAPE_NAMES.index(bs.category_name)
                            blendshapes[idx] = round(bs.score, 4)

                # Extract head pose from transformation matrix if available
                rotation = [0.0, 0.0, 0.0]
                translation = [0.0, 0.0, 0.0]
                if (
                    results.facial_transformation_matrixes
                    and len(results.facial_transformation_matrixes) > 0
                ):
                    mat = results.facial_transformation_matrixes[0]
                    # Matrix is 4x4, extract approximate euler angles
                    rotation = [
                        round(float(mat[0][1]) * 60, 2),  # pitch approx
                        round(float(mat[0][0]) * 60, 2),  # yaw approx
                        round(float(mat[1][0]) * 60, 2),  # roll approx
                    ]
                    translation = [
                        round(float(mat[0][3]), 1),
                        round(float(mat[1][3]), 1),
                        round(float(mat[2][3]), 1),
                    ]
                else:
                    # Fallback: estimate from nose landmark
                    nose = face_landmarks[1] if len(face_landmarks) > 1 else face_landmarks[0]
                    rotation = [
                        round((nose.y - 0.5) * 60, 2),
                        round((nose.x - 0.5) * -60, 2),
                        0.0,
                    ]
                    translation = [
                        round(nose.x * width, 1),
                        round(nose.y * height, 1),
                        round(nose.z * width, 1),
                    ]

                # Gaze direction from iris landmarks (468-477 in the new API)
                if len(face_landmarks) > 473:
                    left_iris = face_landmarks[468]
                    right_iris = face_landmarks[473]
                    gaze_x = round((left_iris.x + right_iris.x) / 2 - 0.5, 4)
                    gaze_y = round((left_iris.y + right_iris.y) / 2 - 0.5, 4)
                    gaze_direction = [gaze_x, gaze_y, -1.0]
                else:
                    gaze_direction = [0.0, 0.0, -1.0]

                # Buffer keyframe for depth estimation (~10Hz)
                if frame_idx % keyframe_interval == 0:
                    resized = cv2.resize(rgb_frame, (518, 518))
                    landmarks_norm = [(lm.x, lm.y) for lm in face_landmarks]
                    keyframe_buffer.append((frame_time, resized, landmarks_norm))

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
        landmarker.close()

        # Depth estimation pass on buffered keyframes
        mesh_keyframes: list[dict] = []
        try:
            mesh_keyframes = _run_depth_on_keyframes(keyframe_buffer, width, height)
            # Backfill mp_z from per-frame landmark data
            kf_times = {kf["time"] for kf in mesh_keyframes}
            frame_lookup = {f["time"]: f for f in frames_data}
            for kf in mesh_keyframes:
                frame = frame_lookup.get(kf["time"])
                if frame and frame["facial_tracking"]["tracking"]["face_detected"]:
                    frame_lms = frame["facial_tracking"]["tracking"]["landmarks"]
                    for i, v in enumerate(kf["vertices"]):
                        if i < len(frame_lms):
                            v[2] = frame_lms[i][2]  # mp_z from 3D landmarks
            logger.info("Depth estimation complete: %d keyframes", len(mesh_keyframes))
        except Exception as e:
            logger.error("Depth estimation failed (non-fatal): %s\n%s", e, traceback.format_exc())
            mesh_keyframes = []

        processing_time = time.monotonic() - t0

        result = {
            "metadata": {
                "source_file": s3_key,
                "format_version": "2.0",
                "created_timestamp": datetime.now(timezone.utc).isoformat(),
                "total_secs": round(total_duration, 3),
                "algorithm": {
                    "name": "mediapipe-face-landmarker",
                    "model": "face_landmarker_v2",
                    "version": "0.10",
                    "processing_time": round(processing_time, 3),
                    "parameters": {
                        "num_faces": 1,
                        "min_detection_confidence": 0.5,
                        "min_tracking_confidence": 0.5,
                        "output_face_blendshapes": True,
                    },
                },
                "video_width": width,
                "video_height": height,
                "mesh_topology": _get_mesh_topology(),
                "depth_estimation": {
                    "model": "depth-anything-v2",
                    "encoder": "vitb",
                    "sample_rate_hz": 10,
                },
            },
            "data": frames_data,
            "mesh_keyframes": mesh_keyframes,
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
