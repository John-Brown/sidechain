# Algorithm Reference, Part A: VAD, Transcription, Facial Tracking

> **Status (2026-09-24):** The algorithm descriptions here (processing steps, parameters, blend-shape weights, state rules, intent taxonomy and prompt) are still the design reference for each stage. The implementation details are from the Phase 0 spike and are historical: `src/processing/...` paths, FaceKitRunner (ARKit, 51 blend shapes), OpenAI/MLX Whisper, Silero VAD v3.1, local CLI usage and output directories. The current implementations are the Modal stages in `workers/ml-pipeline/stages/*.py` (Silero VAD v5, faster-whisper large-v3, MediaPipe FaceLandmarker with 52 blend shapes), documented in [PIPELINE.md](../workers/ml-pipeline/PIPELINE.md); current result shapes live in `packages/shared/src/annotation-types.ts`.

**Parts:** [02a: VAD, transcription, facial tracking](02a-algorithm-reference-vad-transcription-face.md) · [02b: mouth energy, diarization, states](02b-algorithm-reference-mouth-diarization-states.md) · [02c: intents, dependency graph, performance](02c-algorithm-reference-intents-summary.md) · [02d: Phase 0 extras](02d-algorithm-reference-phase0-extras.md)

This document provides detailed technical information about each algorithm in the Sidechain processing pipeline.

## Table of Contents

1. [Voice Activity Detection (VAD)](#1-voice-activity-detection-vad)
2. [Speech Transcription](#2-speech-transcription)
3. [Facial Tracking](#3-facial-tracking)
4. [Mouth Energy Processing](02b-algorithm-reference-mouth-diarization-states.md#4-mouth-energy-processing)
5. [Speaker Diarization](02b-algorithm-reference-mouth-diarization-states.md#5-speaker-diarization)
6. [State Annotation Generation](02b-algorithm-reference-mouth-diarization-states.md#6-state-annotation-generation)
7. [Intent Classification](02c-algorithm-reference-intents-summary.md#7-intent-classification)
8. [Per-Speaker Transcription](02d-algorithm-reference-phase0-extras.md#8-per-speaker-transcription) (Phase 0 only)
9. [Analyst Report Generation](02d-algorithm-reference-phase0-extras.md#9-analyst-report-generation) (Phase 0 only)

---

## 1. Voice Activity Detection (VAD)

### Purpose
Detect when human speech is present in audio and measure audio energy levels.

### Algorithm
**Silero-VAD v3.1** - Neural network-based voice activity detector

### Implementation
**File**: `src/processing/pre_processing/voice_activity/processor.py` (Phase 0; current: `workers/ml-pipeline/stages/vad.py`)

**Model**: Silero VAD v3.1 (PyTorch)
- Size: ~6MB
- Architecture: LSTM-based neural network
- Trained on multiple languages and acoustic conditions

### Input

**Primary**:
- Video file (any format supported by FFmpeg)

**Optional**:
- Audio exclusion ranges from existing annotations (mutes specified time ranges)

### Processing Steps

1. **Audio Extraction**
   ```python
   ffmpeg -i video.mp4 -ar 16000 -ac 2 -f s16le audio.pcm
   ```
   - Sample rate: 16kHz (required by Silero-VAD)
   - Channels: Stereo (preserves spatial information)
   - Format: PCM 16-bit signed integer

2. **Apply Exclusions** (if provided)
   - Mutes audio in specified time ranges
   - Used to exclude music, noise, or other non-speech audio

3. **Windowed Analysis**
   - Window size: 100ms (1600 samples at 16kHz)
   - Hop size: 100ms (no overlap)
   - Output rate: 10Hz (10 samples per second)

4. **VAD Inference**
   - Silero-VAD processes each window
   - Returns speech probability: 0.0 (no speech) to 1.0 (definite speech)
   - Threshold: 0.5 (configurable)

5. **Energy Calculation**
   - RMS (Root Mean Square) energy computed for each window
   - Converted to dBFS (decibels Full Scale)
   - Separate energy for left and right channels (stereo)
   - Range: -96 dBFS (silence) to 0 dBFS (maximum)

### Output Format

**File**: `voice_activity.json`

```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "algorithm": {
      "name": "voice_activity_detection",
      "model": "silero-vad-v3.1",
      "window_size_ms": 100,
      "hop_size_ms": 100,
      "sample_rate": 16000,
      "threshold": 0.5
    }
  },
  "data": [
    {
      "time_range": {
        "start": 1.25,
        "end": 1.35
      },
      "voice_activity": {
        "speech_probability": 0.85,
        "energy_dbfs": -25.3,
        "energy_dbfs_left": -24.1,
        "energy_dbfs_right": -26.5
      }
    }
  ]
}
```

### Performance

- **Speed**: 2-5x realtime on modern CPUs
- **Memory**: ~500MB RAM
- **Device**: CPU only (no GPU required)
- **Example**: 10-minute video processes in 2-5 minutes

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `window_size_ms` | 100 | Analysis window duration |
| `hop_size_ms` | 100 | Time between windows |
| `sample_rate` | 16000 | Audio sample rate (Hz) |
| `threshold` | 0.5 | Speech detection threshold |
| `preserve_stereo` | true | Keep left/right channel info |

### Dependencies

```python
torch
torchaudio
silero-vad
numpy
ffmpeg-python
```

### Known Limitations

- Optimized for clean speech (struggles with heavy background noise)
- May misclassify music or singing as speech
- Fixed 16kHz sample rate requirement
- Does not identify speakers (use diarization for that)

---

## 2. Speech Transcription

### Purpose
Convert spoken words to text with word-level timestamps and confidence scores.

### Algorithm
**OpenAI Whisper large-v3** - State-of-the-art speech recognition model

### Implementation
**File**: `src/processing/pre_processing/speech_transcription/transcriber.py` (Phase 0; current: `workers/ml-pipeline/stages/transcription.py`)

**Model**: Whisper large-v3
- Size: ~3GB
- Architecture: Transformer-based encoder-decoder
- Multilingual support (96+ languages)
- Trained on 680,000 hours of audio

### Input

**Primary**:
- Video file (uses original audio, not affected by exclusions)

**Configuration**:
- Language: English (default, auto-detection available)
- Word timestamps: Enabled
- Temperature: 0.0 (deterministic)

### Processing Steps

1. **Audio Extraction**
   ```python
   ffmpeg -i video.mp4 -ar 16000 -ac 1 -f wav audio.wav
   ```
   - Sample rate: 16kHz
   - Channels: Mono (mixed down from stereo)
   - Format: WAV PCM

2. **Whisper Inference**
   - Model processes entire audio file
   - Generates text transcription
   - Computes word-level timestamps
   - Calculates per-word confidence scores

3. **Single Speaker Assignment**
   - All words assigned to "SPEAKER_00" (0-based numbering)
   - Whisper does not perform diarization
   - Use separate diarization algorithm for multi-speaker scenarios
   - For stereo recordings, use [Per-Speaker Transcription](02d-algorithm-reference-phase0-extras.md#8-per-speaker-transcription) instead

4. **Segmentation**
   - Groups words into speech segments
   - Segments based on pauses and sentence boundaries

### Output Format

**File**: `speech_transcription.json`

```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "algorithm": {
      "name": "speech_transcription",
      "model": "openai-whisper-large-v3",
      "language": "en",
      "word_timestamps": true,
      "temperature": 0.0
    }
  },
  "data": [
    {
      "time_range": {
        "start": 1.5,
        "end": 2.0
      },
      "speech": {
        "word": "hello",
        "speaker": "SPEAKER_00",
        "confidence": 0.95,
        "speech_segment": 0
      }
    },
    {
      "time_range": {
        "start": 2.1,
        "end": 2.4
      },
      "speech": {
        "word": "world",
        "speaker": "SPEAKER_00",
        "confidence": 0.92,
        "speech_segment": 0
      }
    }
  ]
}
```

### Performance

- **Speed**: ~1x realtime (10 min video = 10 min processing)
- **Memory**: 4-6GB RAM
- **Device**: CPU (default) or GPU (CUDA/MPS for faster processing)
- **First Run**: Downloads ~3GB model automatically

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | large-v3 | Whisper model variant |
| `language` | en | Target language code |
| `word_timestamps` | true | Enable word-level timing |
| `temperature` | 0.0 | Sampling temperature |
| `beam_size` | 5 | Beam search width |

### Model Variants

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny | 39MB | 32x | Low |
| base | 74MB | 16x | Medium |
| small | 244MB | 6x | Good |
| medium | 769MB | 2x | Better |
| large-v3 | 3GB | 1x | Best |

### Dependencies

```python
openai-whisper
torch
torchaudio
ffmpeg-python
numpy
```

### Known Limitations

- Single speaker only (no built-in diarization)
- Struggles with heavy accents or non-native speakers
- May hallucinate text during silence
- Large model size requires significant storage
- Processing time scales linearly with audio duration

---

## 3. Facial Tracking

### Purpose
Extract detailed facial features including blend shapes, head pose, gaze direction, and facial landmarks.

### Algorithm
**Apple FaceKitRunner** - ARKit-based facial tracking

### Implementation
**File**: `src/processing/pre_processing/facial_tracking/facial_tracking_processor.py` (Phase 0; current: `workers/ml-pipeline/stages/facial_tracking.py`)

**Tool**: FaceKitRunner executable
- Proprietary Apple technology
- Based on ARKit Face Tracking
- macOS only (requires Metal GPU support)

### Input

**Primary**:
- Video file (any resolution)

**Optional Configuration**:
- Image scaling: 0.25 to 1.0 (default: 0.5 for 4x speedup)
- Target FPS: Skip frames for faster processing
- Face detection confidence threshold

### Processing Steps

1. **Video Frame Extraction**
   - FaceKitRunner reads video file directly
   - Processes at native frame rate or downsampled FPS

2. **Face Detection**
   - ARKit detects faces in each frame
   - Supports single face tracking (primary face)

3. **Feature Extraction**
   - **51 Blend Shapes**: Facial muscle activation coefficients (0.0 to 1.0)
   - **Head Pose**: Rotation (pitch/yaw/roll) and translation (x/y/z)
   - **Gaze Direction**: 3D vector indicating look direction
   - **Facial Landmarks**: 2D points for key facial features
   - **Confidence Score**: Tracking quality metric

4. **Output Rate**
   - Typically 10-30 FPS depending on settings
   - Higher for fast-moving videos
   - Lower for efficiency on static scenes

### Output Format

**File**: `facial_tracking.json`

```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "video_width": 1920,
    "video_height": 1080,
    "algorithm": {
      "name": "facial_tracking",
      "tool": "FaceKitRunner",
      "version": "1.0",
      "scale_factor": 0.5,
      "target_fps": 30
    }
  },
  "data": [
    {
      "time": 2.1,
      "facial_tracking": {
        "tracking": {
          "blendshapes": [0.8, 0.1, 0.2, 0.0, 0.5, ...],
          "head_pose": {
            "rotation": [15.2, -5.8, 2.1],
            "translation": [0.05, -0.02, -0.5]
          },
          "gaze_direction": [0.1, -0.05, 0.99],
          "landmarks": [
            [512, 384], [518, 386], [524, 388], ...
          ],
          "confidence": 0.95,
          "face_detected": true
        }
      }
    }
  ]
}
```

### ARKit Blend Shapes (51 total)

**Mouth** (18):
- JawOpen, JawForward, JawLeft, JawRight
- MouthClose, MouthFunnel, MouthPucker
- MouthLeft, MouthRight, MouthSmile_L, MouthSmile_R
- MouthFrown_L, MouthFrown_R, MouthDimple_L, MouthDimple_R
- MouthStretch_L, MouthStretch_R
- MouthPress_L, MouthPress_R

**Lips** (8):
- LipsUpperUp_L, LipsUpperUp_R
- LipsLowerDown_L, LipsLowerDown_R
- LipsPucker, LipsFunnel
- LipsStretch_L, LipsStretch_R

**Eyes** (12):
- EyeBlink_L, EyeBlink_R
- EyeLookDown_L, EyeLookDown_R
- EyeLookIn_L, EyeLookIn_R
- EyeLookOut_L, EyeLookOut_R
- EyeLookUp_L, EyeLookUp_R
- EyeSquint_L, EyeSquint_R

**Brows** (8):
- BrowDown_L, BrowDown_R
- BrowInnerUp
- BrowOuterUp_L, BrowOuterUp_R

**Cheeks** (4):
- CheekPuff, CheekSquint_L, CheekSquint_R

**Nose** (2):
- NoseSneer_L, NoseSneer_R

**Tongue** (1):
- TongueOut

### Performance

- **Speed**: 4-20x realtime depending on settings
  - Full resolution (1.0x): Slowest, best quality
  - Half resolution (0.5x): 4x faster (recommended)
  - Quarter resolution (0.25x): 16x faster
  - Combined with FPS reduction: Up to 20x speedup

- **Memory**: 2-4GB RAM
- **Device**: CPU (uses Metal GPU if available)
- **Example**: 10-minute video at 0.5x scale processes in 2-3 minutes

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `scale_factor` | 0.5 | Image scaling (0.25-1.0) |
| `target_fps` | None | FPS for frame skipping |
| `min_confidence` | 0.5 | Minimum tracking confidence |

### Dependencies

```python
FaceKitRunner executable (macOS binary)
opencv-python (for video reading)
numpy
```

### Setup Requirements

**First-time setup**:
```bash
xattr -d com.apple.quarantine path/to/FaceKitRunner
chmod +x path/to/FaceKitRunner
```

### Known Limitations

- macOS only (requires Metal GPU)
- Single face tracking (primary/largest face)
- Performance degrades with extreme head angles
- Requires clear view of face
- Not available for Linux/Windows environments

---

Next: [Part B: mouth energy, diarization, states](02b-algorithm-reference-mouth-diarization-states.md)
