# Facial Tracking Reference

What FaceKitRunner extracts, how it's consumed, and what alternatives exist for each capability.

## What FaceKitRunner Actually Does

FaceKitRunner is a macOS binary that wraps Apple's ARKit face tracking. It processes video frames and outputs per-frame JSON with four data types:

| Output | Description | Downstream Use |
|--------|-------------|----------------|
| **51 Blend Shapes** | Facial muscle activation coefficients (0.0–1.0) | Mouth energy → visible speaker detection |
| **Head Pose** | 3×3 rotation matrix + translation vector | Head pose visualization track |
| **Gaze Direction** | 3D lookat vector (mm from face center) | Gaze direction visualization track |
| **Facial Landmarks** | 68 landmark positions (normalized 0–1) | Raw inspector panel, quality metrics |

### Processing Pipeline

```
Original Video
    ↓
Video Normalization
    • Convert to .mov (H.264)
    • Downscale to ≤500px on shorter dimension
    • VFR → CFR at 30fps
    ↓
Camera Calibration
    • Generate calib.yml (67° FOV, resolution-specific focal length)
    ↓
FaceKitRunner -i video.mov -o output_dir/ --rgb-only
    • Outputs one JSON file per frame
    ↓
Parse + Transform
    • Rotation matrix → Euler angles (pitch, yaw, roll in degrees)
    • Lookat vector → gaze angles (yaw, pitch in radians)
    • Landmarks filtered (confidence >0.3, not occluded, detected source)
    • Blendshapes rounded to 4 significant figures
    ↓
facial_tracking.json (unified annotation format)
```

### Invocation Details

```bash
FaceKitRunner-macOS -i <video_path> -o <output_dir> --rgb-only
```

- Runs as subprocess with `DYLD_FRAMEWORK_PATH` set to the FaceKitRunner directory
- Requires macOS code signing / Gatekeeper approval
- Binary located at `bin/FaceKitRunner-macOS/FaceKitRunner-macOS`
- One JSON file per video frame, sorted by frame index

---

## Output Breakdown

### 1. Blend Shapes (51 coefficients)

ARKit's face mesh parameterization. Each coefficient ranges 0.0 (neutral) to 1.0 (fully activated).

**Eyes (14)**:
| Left | Right |
|------|-------|
| eyeBlinkLeft | eyeBlinkRight |
| eyeLookDownLeft | eyeLookDownRight |
| eyeLookInLeft | eyeLookInRight |
| eyeLookOutLeft | eyeLookOutRight |
| eyeLookUpLeft | eyeLookUpRight |
| eyeSquintLeft | eyeSquintRight |
| eyeWideLeft | eyeWideRight |

**Brow (5)**: browDownLeft, browDownRight, browInnerUp, browOuterUpLeft, browOuterUpRight

**Cheek (3)**: cheekPuff, cheekSquintLeft, cheekSquintRight

**Mouth (23)**:
mouthClose, mouthDimpleLeft/Right, mouthFrownLeft/Right, mouthFunnel, mouthLeft/Right, mouthLowerDownLeft/Right, mouthPressLeft/Right, mouthPucker, mouthRollLower/Upper, mouthShrugLower/Upper, mouthSmileLeft/Right, mouthStretchLeft/Right, mouthUpperUpLeft/Right

**Nose (2)**: noseSneerLeft, noseSneerRight

**Jaw (4)**: jawForward, jawLeft, jawOpen, jawRight

**Tongue (1)**: tongueOut

### 2. Head Pose

**Raw from FaceKitRunner**: 3×3 rotation matrix + [x, y, z] translation (mm)

**Sidechain's transform** (facial_tracking_processor.py):
- Flip Y,Z rows of rotation matrix (OpenCV coordinate convention)
- Extract Euler angles via `atan2` decomposition ("Friend's Method")
- Invert pitch so "nod up = positive"
- Handle portrait video rotation

**Output**: `[pitch_deg, yaw_deg, roll_deg]` + `[x_mm, y_mm, z_mm]`

### 3. Gaze Direction

**Raw from FaceKitRunner**: 3D lookat vector `[x, y, z]` in mm

**Sidechain's transform**:
- `yaw = atan2(x, z)` — horizontal angle, -π to π
- `pitch = atan2(y, sqrt(x² + z²))` — vertical angle, -π/2 to π/2
- Rejected if vector too small: `|x| < 1mm, |y| < 1mm, |z| < 10mm`

**Output**: `{yaw_radians, pitch_radians}`

### 4. Facial Landmarks (68 points)

Standard 68-point facial landmark set. Each landmark has:
- `source`: "detected" (valid) or "predicted" (interpolated)
- `confidence`: 0.0–1.0
- `occluded`: "yes"/"no"
- `x, y`: pixel coordinates
- `xn, yn`: normalized coordinates (0–1)

**Quality filter**: Only landmarks with source="detected", confidence >0.3, and not occluded are kept. Output is `[[xn, yn], ...]` arrays.

---

## Downstream Data Flow

```
facial_tracking.json
    │
    ├─→ Mouth Energy Processor
    │       Uses: 10 of 51 blend shapes (mouth-related)
    │       Weights: empirical Cohen's d discriminability scores
    │       Window: 500ms sliding, 100ms step → 10Hz output
    │       Output: mouth_energy.json
    │           │
    │           └─→ Visible Speaker Detection
    │                   Correlates mouth energy with diarization segments
    │                   Uses: Welch's t-test or bootstrap analysis
    │                   Output: visible_speaker_probability in diarization.json metadata
    │
    └─→ Sidechain App (SwiftUI)
            ├─→ Gaze Direction Track (yaw, pitch vector visualization)
            ├─→ Head Pose Track (yaw, pitch vector visualization)
            ├─→ Raw Inspector Panel (all 51 blend shapes, grouped)
            └─→ Landmark overlay (quality metrics)
```

### Critical Path: Blend Shapes → Mouth Energy → Visible Speaker

This is the only path where facial tracking affects the **automated pipeline**. The 10 discriminative blend shapes and their weights:

| Blend Shape | Weight | Role |
|-------------|--------|------|
| mouthDimpleRight | 1.259 | Speech articulation |
| lipsPucker | 1.120 | Lip rounding |
| mouthDimpleLeft | 1.084 | Speech articulation |
| mouthSmileLeft | 1.005 | Expression |
| mouthPressRight | 0.991 | Lip compression |
| mouthSmileRight | 0.850 | Expression |
| mouthPressLeft | 0.820 | Lip compression |
| jawOpen | 0.750 | Primary speech indicator |
| lipsStretchRight | 0.680 | Lip stretching |
| lipsStretchLeft | 0.650 | Lip stretching |

Everything else (gaze, head pose, landmarks, remaining 41 blend shapes) is **visualization-only** — consumed by the Swift app for human review, not by the automated pipeline.

---

## Cloud Replacement Strategy

### What Actually Needs Replacing

For the **automated pipeline**, you only need:
1. **10 mouth blend shapes** (or equivalent mouth motion signal)
2. At sufficient temporal resolution (~10-30 fps)
3. Accurate enough to discriminate "speaking" from "not speaking"

For **full feature parity**, you also need:
4. Head pose (pitch, yaw, roll)
5. Gaze direction
6. Facial landmarks

### Alternative Approaches

#### A. MediaPipe Face Mesh (Best Overall Alternative)

**What it provides**:
- 478 3D facial landmarks (vs ARKit's 68 2D landmarks)
- Includes iris tracking for gaze estimation
- 52 blend shape coefficients (MediaPipe's `FaceLandmarker` with `output_face_blendshapes=True`)
- Cross-platform (Linux, macOS, Windows, mobile, browser)

**Blend shape mapping**: MediaPipe outputs ARKit-compatible blend shape names. The 10 mouth blend shapes used for mouth energy map directly:

| Sidechain Uses | MediaPipe Provides | Direct Match? |
|-------------|-------------------|---------------|
| mouthDimpleRight/Left | mouthDimpleRight/Left | Yes |
| lipsPucker | lipsPucker | Yes (as mouthPucker) |
| mouthSmileRight/Left | mouthSmileRight/Left | Yes |
| mouthPressRight/Left | mouthPressRight/Left | Yes |
| jawOpen | jawOpen | Yes |
| lipsStretchRight/Left | mouthStretchRight/Left | Yes |

**Head pose**: Derivable from 3D landmark positions (solvePnP or direct landmark geometry).

**Gaze**: Iris landmarks enable gaze estimation. Not as refined as ARKit but usable.

**Performance**: ~5-15ms per frame on CPU. Faster than FaceKitRunner for most cases.

**Effort**: Low-medium. The blend shape output is ARKit-compatible, so mouth energy weights wouldn't need recalibration. Head pose and gaze need custom extraction from landmarks.

**License**: Apache 2.0 (fully permissive).

#### B. ONNX Runtime + Face Analysis Models

Run ARKit-equivalent inference via ONNX models:

- **Face detection**: SCRFD or RetinaFace (ONNX)
- **Blend shapes**: Train a small model to predict ARKit coefficients from landmarks (research exists for this mapping)
- **Landmarks**: 2DFAN or similar (68-point, ONNX)

**Effort**: Medium-high. Requires assembling multiple models and validating output quality.

#### C. Cloud Vision APIs

| Service | Blend Shapes | Head Pose | Landmarks | Gaze | Cost |
|---------|-------------|-----------|-----------|------|------|
| AWS Rekognition | No | Yes (rough) | Yes (multiple formats) | No | $0.001/image |
| Google Cloud Vision | No | Yes (rough) | Yes | No | $0.0015/image |
| Azure Face API | No | Yes | Yes (27-point) | Yes | $0.001/image |
| Apple Vision (on-device) | Yes (via VNFaceObservation) | Yes | Yes | Yes | Free (macOS only) |

**Problem**: None of the cloud vision APIs provide ARKit blend shape coefficients. You'd get landmarks and head pose but lose the mouth energy signal. You'd need to derive mouth motion from landmark displacement instead — workable but requires recalibrating the mouth energy algorithm.

**Cost**: At 30fps for a 10-minute video = 18,000 API calls per video. At ~$0.001/call = ~$18/video. Expensive and slow (network latency per frame).

#### D. Offline Batch Processing on macOS

Keep FaceKitRunner but run it as a pre-processing step on macOS hardware:

```
Video Upload → Cloud Storage
    ↓
macOS Worker (on-prem or Mac Mini rack)
    ↓ FaceKitRunner
facial_tracking.json → Cloud Storage
    ↓
Cloud Workers (Linux)
    ↓ mouth_energy, diarization, etc.
Results
```

**Pros**: Zero code changes. Full fidelity. FaceKitRunner is fast (4-20x realtime).
**Cons**: Requires macOS hardware. Adds an extra processing hop.

A single Mac Mini could handle the facial tracking for many videos concurrently. At 4-20x realtime, a 10-minute video processes in 30 seconds to 2.5 minutes.

#### E. Skip Facial Tracking Entirely

The visible speaker detection has two methods:
1. **Mouth energy** (from facial tracking) — requires FaceKitRunner
2. **Audio channel detection** (from stereo audio) — no FaceKitRunner needed

For stereo recordings with per-speaker mics, audio channel detection provides speaker identity without any video analysis. Facial tracking becomes purely a visualization enhancement.

**If your recordings are stereo with per-speaker mics, you may not need facial tracking for the automated pipeline at all.**

---

## Recommendation Matrix

| Scenario | Recommended Approach |
|----------|---------------------|
| Stereo recordings, cloud deployment | Skip facial tracking (audio channel detection sufficient) |
| Mono recordings, cloud deployment | MediaPipe Face Mesh (blend shape compatible) |
| Full feature parity, cloud | MediaPipe for pipeline + optional macOS worker for FaceKit validation |
| Batch processing, existing macOS hardware | Offline FaceKit (zero code changes) |
| Web-based annotation UI needed | MediaPipe (runs in browser via WASM) |

### If Choosing MediaPipe

The integration path:

1. Replace `facial_tracking_processor.py` internals (keep same output format)
2. Use `FaceLandmarker` with `output_face_blendshapes=True`
3. Extract head pose from landmark geometry
4. Extract gaze from iris landmarks
5. Output `facial_tracking.json` in identical schema
6. Mouth energy processor needs **no changes** (same blend shape names)
7. Validate mouth energy output against FaceKitRunner baseline on a test set

The key insight: MediaPipe's blend shape output deliberately matches ARKit's naming convention. This was a design choice by the MediaPipe team specifically to enable this kind of migration.
