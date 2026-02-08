# Algorithm Reference Guide

This document provides detailed technical information about each algorithm in the Curator processing pipeline.

## Table of Contents

1. [Voice Activity Detection (VAD)](#1-voice-activity-detection-vad)
2. [Speech Transcription](#2-speech-transcription)
3. [Facial Tracking](#3-facial-tracking)
4. [Mouth Energy Processing](#4-mouth-energy-processing)
5. [Speaker Diarization](#5-speaker-diarization)
6. [State Annotation Generation](#6-state-annotation-generation)
7. [Intent Classification](#7-intent-classification)
8. [Per-Speaker Transcription](#8-per-speaker-transcription)
9. [Analyst Report Generation](#9-analyst-report-generation)

---

## 1. Voice Activity Detection (VAD)

### Purpose
Detect when human speech is present in audio and measure audio energy levels.

### Algorithm
**Silero-VAD v3.1** - Neural network-based voice activity detector

### Implementation
**File**: `src/processing/pre_processing/voice_activity/processor.py`

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
**File**: `src/processing/pre_processing/speech_transcription/transcriber.py`

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
   - For stereo recordings, use [Per-Speaker Transcription](#8-per-speaker-transcription) instead

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
**File**: `src/processing/pre_processing/facial_tracking/facial_tracking_processor.py`

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

## 4. Mouth Energy Processing

### Purpose
Quantify mouth movement intensity using discriminative facial blend shapes.

### Algorithm
**Discriminative Blend Shape Analysis** - Weighted deviation analysis

### Implementation
**File**: `src/processing/pre_processing/mouth_energy/mouth_energy_processor.py`

**Method**: Statistical analysis of facial tracking data
- Uses 10 most discriminative mouth-related blend shapes
- Applies fixed empirical weights
- Calculates normalized deviation over sliding windows

### Input

**Primary**:
- `facial_tracking.json` (requires facial tracking data)
- Video duration (for accurate time coverage validation)

### Processing Steps

1. **Blend Shape Selection**
   - Extract 10 discriminative mouth blend shapes from facial tracking
   - Pre-determined features based on empirical analysis

2. **Sliding Window Analysis**
   - Window size: 500ms
   - Step size: 100ms (overlapping windows)
   - Output rate: 10Hz

3. **Deviation Calculation**
   - For each blend shape in window:
     - Calculate mean and standard deviation
     - Compute normalized deviation: `(value - mean) / (2 * std_dev)`

4. **Weighted Aggregation**
   - Multiply each deviation by fixed weight
   - Sum weighted deviations
   - Result is "mouth energy" score

### Discriminative Blend Shapes & Weights

| Blend Shape | Weight | Rationale |
|-------------|--------|-----------|
| MouthDimple_R | 1.259 | Strong indicator of speech |
| LipsPucker | 1.120 | Distinctive lip movement |
| MouthDimple_L | 1.084 | Strong indicator of speech |
| MouthSmile_L | 1.005 | Expressive movement |
| MouthPress_R | 0.991 | Lip compression during speech |
| MouthSmile_R | 0.850 | Expressive movement |
| MouthPress_L | 0.820 | Lip compression during speech |
| JawOpen | 0.750 | Primary speech indicator |
| LipsStretch_R | 0.680 | Lip stretching |
| LipsStretch_L | 0.650 | Lip stretching |

### Output Format

**File**: `mouth_energy.json`

```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "algorithm": {
      "name": "mouth_energy",
      "version": "1.0",
      "window_duration_ms": 500,
      "step_duration_ms": 100,
      "num_blend_shapes": 10
    }
  },
  "data": [
    {
      "time_range": {
        "start": 1.0,
        "end": 1.5
      },
      "mouth_energy": {
        "blend_shape_energy": {
          "MouthDimple_R": {
            "raw_value": 0.45,
            "deviation": 0.12
          },
          "LipsPucker": {
            "raw_value": 0.23,
            "deviation": 0.08
          }
        },
        "mouth_energy": 0.234
      }
    }
  ]
}
```

### Performance

- **Speed**: Fast post-processing (processes in seconds)
- **Memory**: Minimal (<100MB)
- **Device**: CPU only
- **Example**: 10-minute video processes in <10 seconds

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `window_duration_ms` | 500 | Analysis window size |
| `step_duration_ms` | 100 | Step between windows |
| `normalization_factor` | 2.0 | Standard deviation multiplier |

### Use Case

Mouth energy is used in speaker diarization to:
- Identify the "visible speaker" in videos
- Correlate mouth movements with audio speech segments
- Improve diarization accuracy when one speaker is on-camera

### Dependencies

```python
numpy
scipy (for statistical functions)
```

### Known Limitations

- Requires high-quality facial tracking data
- Only tracks visible speaker (on-camera person)
- Does not work for off-camera speakers
- Sensitive to head angle and occlusion
- Empirical weights may not generalize to all scenarios

---

## 5. Speaker Diarization

### Purpose
Identify "who spoke when" by segmenting audio into speaker-labeled time ranges.

### Algorithm
**pyannote.audio 4.x** - Neural speaker diarization pipeline

### Implementation
**File**: `src/processing/pre_processing/diarization/diarization_processor.py`

**Model**: pyannote/speaker-diarization-community-1
- Architecture: Multi-stage neural pipeline
- Segmentation: Detects speech regions
- Embedding: Extracts speaker representations
- Clustering: Groups segments by speaker
- License: MIT (requires HuggingFace model agreement)

### Input

**Primary**:
- Video file (audio extracted via FFmpeg)

**Optional Enhancements**:
- `voice_activity.json` - For audio channel speaker detection
- `mouth_energy.json` - For visible speaker identification
- `num_speakers` - Hint for number of speakers (auto-detects if not provided)

**Configuration**:
- Audio exclusions: Respects exclusion ranges if provided

### Processing Steps

1. **Audio Extraction**
   ```python
   ffmpeg -i video.mp4 -ar 16000 -ac 2 -f wav audio.wav
   ```
   - Sample rate: 16kHz (required by pyannote)
   - Channels: Stereo (for channel-based speaker detection)

2. **Apply Exclusions** (if provided)
   - Mutes excluded time ranges
   - Prevents false speaker detection in excluded regions

3. **Neural Diarization Pipeline**
   - **Segmentation**: Detect voice activity
   - **Embedding**: Extract speaker embeddings from segments
   - **Clustering**: Group segments by speaker similarity
   - **Resegmentation**: Refine boundaries

4. **Speaker Labeling**
   - Assigns speaker IDs: SPEAKER_00, SPEAKER_01, etc.
   - Number based on detection order (not consistent across videos)

5. **Visible Speaker Detection** (if mouth energy available)
   - Correlates mouth energy peaks with speech segments
   - Calculates probability each speaker is the visible person
   - Uses temporal alignment between mouth movement and audio

6. **Audio Channel Detection** (if voice activity available)
   - Analyzes left/right stereo energy during speech
   - Identifies if speakers are in separate audio channels
   - Useful for headset recordings with isolated channels

### Output Format

**File**: `diarization.json`

```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "algorithm": {
      "name": "speaker_diarization",
      "model": "pyannote/speaker-diarization-community-1",
      "processing_time": 92.3,
      "parameters": {
        "speaker_count": 2
      }
    },
    "requested_speakers": null,
    "detected_speakers": 2,
    "visible_speaker_probability": {
      "SPEAKER_00": 0.95,
      "SPEAKER_01": null
    },
    "visible_speaker_detection_status": "SUCCESS",
    "visible_speaker_detection_message": "...",
    "audio_channel_speaker_probability": {
      "left": {"SPEAKER_00": 0.98},
      "right": {"SPEAKER_01": 0.99}
    },
    "audio_channel_detection_status": "SUCCESS",
    "audio_channel_detection_message": "...",
    "speaker_timing_metadata": {
      "SPEAKER_00": {
        "total_duration_secs": 60.2,
        "turn_count": 15,
        "avg_turn_duration_secs": 4.01
      }
    }
  },
  "data": [
    {
      "time_range": {
        "start": 0.0,
        "end": 5.2
      },
      "diarization": {
        "speaker": "SPEAKER_00"
      }
    },
    {
      "time_range": {
        "start": 5.2,
        "end": 8.7
      },
      "diarization": {
        "speaker": "SPEAKER_01"
      }
    },
    {
      "time_range": {
        "start": 30.0,
        "end": 35.0
      },
      "diarization": {
        "speaker": "EXCLUDED_RANGE"
      }
    }
  ]
}
```

### Performance

- **Speed**: ~0.3x realtime (slowest stage in pipeline)
- **Memory**: 4-8GB RAM
- **Device**:
  - MPS (Metal Performance Shaders) on Apple Silicon
  - CUDA on NVIDIA GPUs
  - CPU fallback
- **Example**: 10-minute video processes in 30-35 minutes

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `num_speakers` | Auto | Number of speakers (auto-detect if None) |
| `min_speakers` | 1 | Minimum speakers for auto-detection |
| `max_speakers` | 10 | Maximum speakers for auto-detection |
| `device` | Auto | Processing device (mps/cuda/cpu) |

### Device Selection

```python
Priority: MPS > CUDA > CPU

if torch.backends.mps.is_available():
    device = "mps"
elif torch.cuda.is_available():
    device = "cuda"
else:
    device = "cpu"
```

### Dependencies

```python
pyannote.audio==4.x
torch
torchaudio
ffmpeg-python
numpy
scipy
```

### Setup Requirements

**First-time setup**:
1. Create HuggingFace account
2. Accept model agreement at: https://huggingface.co/pyannote/speaker-diarization
3. Generate HF token
4. Save token to file:
   ```bash
   echo "your_token_here" > ~/Library/Application\ Support/Curator/huggingfacetoken.txt
   ```
   (Environment variable `HUGGING_FACE_TOKEN` is also checked as fallback)

### Known Limitations

- Struggles with overlapping speech
- Speaker IDs not consistent across videos
- Requires clean audio for best results
- Auto-detection may over/under-estimate speaker count
- First run downloads ~500MB of models
- Slowest algorithm in the pipeline

---

## 6. State Annotation Generation

### Purpose
Convert speaker diarization segments into structured speaking/listening state annotations.

### Algorithm
**Rule-based State Machine** - Deterministic conversion

### Implementation
**File**: `src/processing/state_annotation/speaker_state_generator.py`

**Method**: Direct mapping from diarization to states
- No ML models involved
- Instant processing
- Deterministic output

### Input

**Primary**:
- `diarization.json` (speaker segments)
- Video duration (for validation)

### Processing Steps

1. **Load Diarization Data**
   - Read speaker segments with time ranges

2. **State Mapping**
   - For each diarization segment:
     - Create `expression.state.speaking` annotation
     - Time range matches diarization segment
     - Note field includes speaker ID and metadata

3. **Metadata Enrichment**
   - Add visible speaker probability (if available)
   - Add audio channel information (if available)
   - Include speaker label

4. **Gap Handling** (optional)
   - Can generate `expression.state.listening` for non-speaking periods
   - Currently not implemented (gaps left unannotated)

### Output Format

**File**: `annotations.json` (subset of all annotations)

```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "algorithm": {
      "name": "state_annotation_generator",
      "version": "1.0",
      "source_algorithm": "speaker_diarization"
    }
  },
  "data": [
    {
      "time_range": {
        "start": 0.0,
        "end": 5.2
      },
      "category": "expression.state.speaking",
      "note": "Visible speaker SPEAKER_00 (prob: 0.85)",
      "parameters": {}
    },
    {
      "time_range": {
        "start": 5.2,
        "end": 8.7
      },
      "category": "expression.state.listening",
      "note": "Speaker SPEAKER_01 (off-camera)",
      "parameters": {}
    }
  ]
}
```

### State Categories

| Category | Description | Source |
|----------|-------------|--------|
| `expression.state.speaking` | Person is actively speaking | Diarization segment |
| `expression.state.listening` | Person is not speaking | Gap between speaking segments |

### Performance

- **Speed**: Instant (<1 second)
- **Memory**: Minimal (<50MB)
- **Device**: CPU only
- **Example**: Any duration video processes instantly

### Key Parameters

None (deterministic conversion)

### Dependencies

```python
None (pure Python logic)
```

### Known Limitations

- Direct 1:1 mapping (no temporal smoothing)
- Inherits all diarization errors
- Does not merge adjacent segments from same speaker
- Currently does not generate listening states
- No validation of state consistency

---

## 7. Intent Classification

### Purpose
Classify expressive intents, intensity, and emotional valence of speech segments using large language models.

### Algorithm
**LLM-based Classification** - Context-aware natural language understanding

### Implementation
**File**: `src/processing/intent_annotation/intent_processor.py`

**Models**:
- Anthropic Claude (via Floodgate API)
- OpenAI GPT (via Floodgate API)

**Method**: Structured prompting with conversation context

### Input

**Primary**:
- `annotations.json` (expression.state.* annotations for time boundaries)
- `speech_transcription.json` (transcribed words)
- `voice_activity.json` (speech probability and energy)

**Configuration**:
- Model selection (Claude vs GPT)
- Temperature: 0.3 (balanced determinism)
- Max context: 10 previous chunks

### Processing Steps

1. **Chunk Extraction**
   - Use state annotation time ranges as chunk boundaries
   - Extract transcribed words within each time range
   - Combine with voice activity metrics
   - Associate with speaker ID

2. **Context Window Construction**
   - For each chunk to classify:
     - Include 10 previous chunks as context
     - Maintain conversation flow
     - Preserve speaker identity

3. **Prompt Generation**
   - Structured prompt with:
     - Current chunk text and speaker
     - Context chunks (10 previous)
     - Classification instructions
     - Output format specification

4. **LLM Inference** (parallel)
   - Send up to 20 concurrent requests
   - Process multiple chunks simultaneously
   - Apply rate limiting to avoid API throttling

5. **Response Parsing**
   - Extract structured fields:
     - Intent type (6 categories)
     - Intensity level (3 levels)
     - Valence (3 types)
     - Confidence score
     - Reasoning explanation
   - Validate against allowed values
   - Handle partial or malformed responses

6. **Result Assembly**
   - Match classifications back to time ranges
   - Create intent annotation entries
   - Include confidence and reasoning

### Output Format

**File**: `intent_classification.json`

```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "algorithm": {
      "name": "intent_classification",
      "model": "claude-3-5-sonnet",
      "temperature": 0.3,
      "max_context_chunks": 10,
      "max_concurrent_requests": 20,
      "processing_time": 45.2
    }
  },
  "data": [
    {
      "time_range": {
        "start": 0.0,
        "end": 5.2
      },
      "intent_classification": {
        "intent": "engage",
        "intensity": "moderate",
        "valence": "positive",
        "confidence": 0.85,
        "reasoning": "Speaker is initiating conversation with friendly tone and open-ended question"
      }
    },
    {
      "time_range": {
        "start": 5.2,
        "end": 8.7
      },
      "intent_classification": {
        "intent": "inform",
        "intensity": "high",
        "valence": "neutral",
        "confidence": 0.92,
        "reasoning": "Speaker is providing detailed factual information in response to question"
      }
    }
  ]
}
```

### Intent Types

| Intent | Description | Example |
|--------|-------------|---------|
| `engage` | Initiating or maintaining interaction | "Hey, how are you?" |
| `inform` | Sharing information or facts | "The meeting is at 3pm" |
| `inquire` | Seeking information or asking questions | "What do you think about this?" |
| `challenge` | Questioning or pushing back | "I disagree with that approach" |
| `comfort` | Providing emotional support | "Don't worry, it'll be okay" |
| `celebrate` | Expressing joy or achievement | "That's amazing news!" |

### Intensity Levels

| Level | Description |
|-------|-------------|
| `low` | Subtle, understated expression |
| `moderate` | Normal, clear expression |
| `high` | Strong, emphatic expression |

### Valence Types

| Valence | Description |
|---------|-------------|
| `positive` | Positive emotional tone |
| `neutral` | Neutral emotional tone |
| `negative` | Negative emotional tone |

### Performance

- **Speed**: Variable (depends on API rate limits)
- **Throughput**: Up to 20 concurrent chunks
- **Latency**: 2-5 seconds per chunk
- **Cost**: API usage charges apply
- **Example**: 10-minute conversation (50 chunks) processes in 5-10 minutes

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | claude-3-5-sonnet | LLM model to use |
| `temperature` | 0.3 | Sampling temperature |
| `max_context_chunks` | 10 | Previous chunks for context |
| `max_concurrent` | 20 | Parallel request limit |
| `default_confidence` | 0.5 | Fallback confidence |

### Prompt Template

```python
CLASSIFICATION_PROMPT = """
Analyze the following speech chunk and classify the speaker's expressive intent.

Current chunk:
Speaker: {speaker}
Text: {text}
Duration: {duration}s

Context (previous 10 chunks):
{context_chunks}

Classify the intent into one of:
- engage: Initiating or maintaining interaction
- inform: Sharing information
- inquire: Seeking information
- challenge: Questioning or pushing back
- comfort: Providing emotional support
- celebrate: Expressing joy or achievement

Also classify:
- Intensity: low, moderate, high
- Valence: positive, neutral, negative
- Confidence: 0.0 to 1.0

Respond in JSON format:
{
  "intent": "...",
  "intensity": "...",
  "valence": "...",
  "confidence": 0.0,
  "reasoning": "..."
}
"""
```

### Dependencies

```python
anthropic (for Claude)
openai (for GPT)
asyncio (for parallel processing)
aiohttp (for async HTTP)
json
```

### API Setup

**Environment Variables**:
```bash
export ANTHROPIC_API_KEY="your_key"
export OPENAI_API_KEY="your_key"
# Or use Floodgate unified endpoint
export FLOODGATE_API_KEY="your_key"
export FLOODGATE_ENDPOINT="https://api.floodgate.com"
```

### Known Limitations

- Requires API access and internet connectivity
- Cost scales with video duration (API charges)
- Quality depends on transcription accuracy
- May misclassify subtle or ambiguous intents
- Context limited to 10 previous chunks
- No multi-speaker intent modeling (treats chunks independently)
- Rate limiting may slow processing
- Non-deterministic (temperature > 0)

### Error Handling

- Retries failed requests (3 attempts)
- Falls back to default confidence on parsing errors
- Validates all structured fields
- Logs classification failures for review
- Continues processing on individual failures

---

## Algorithm Dependency Graph

```
video_file
    ↓
┌───┴───┬───────────┬──────────────┐
│       │           │              │
VAD  Whisper  FaceKit         Audio Extract
│       │           │              │
│       │           ↓              │
│       │      Mouth Energy        │
│       │           │              │
└───┬───┴───────┬───┴──────────────┘
    │           │
    └─────┬─────┘
          ↓
    Diarization
          ↓
   State Annotation
          ↓
    ┌─────┴─────┐
    │           │
    │      Transcription
    │           │
    └─────┬─────┘
          ↓
  Intent Classification


ALTERNATIVE PATH (stereo recordings):

video_file (stereo audio)
    ↓
┌───┴──────────────────┐
│                      │
FaceKit          Source Separation
│                (Fast-MNMF)
↓                      ↓
Mouth Energy    ┌──────┴──────┐
                │             │
           Audio Gate    Audio Gate
           (Channel L)   (Channel R)
                │             │
                ↓             ↓
           MLX Whisper   MLX Whisper
                │             │
                └──────┬──────┘
                       ↓
              Merge + Deduplicate
                       ↓
         speech_transcription.json
         diarization.json
```

## Performance Summary Table

| Algorithm | Speed | Memory | Device | Model Size |
|-----------|-------|--------|--------|------------|
| VAD | 2-5x RT | 500MB | CPU | ~6MB |
| Transcription (Whisper) | 1x RT | 4-6GB | CPU/GPU | ~3GB |
| Per-Speaker (MLX Whisper) | 4-8x RT | 2-4GB | Apple Silicon | ~3GB |
| Facial Tracking | 4-20x RT | 2-4GB | CPU/Metal | N/A |
| Mouth Energy | Instant | <100MB | CPU | N/A |
| Diarization | 0.3x RT | 4-8GB | MPS/CUDA/CPU | ~500MB |
| Source Separation | ~0.5x RT | 2-4GB | CPU | N/A |
| State Annotation | Instant | <50MB | CPU | N/A |
| Intent Classification | Variable | <1GB | API | N/A |

**RT = Realtime** (1x RT means processing takes same time as video duration)

---

## 8. Per-Speaker Transcription

### Purpose
Transcribe stereo recordings with dedicated microphones per speaker, producing per-speaker word-level transcription with accurate speaker attribution.

### Algorithm
**Stereo Source Separation + MLX Whisper** - Multi-stage pipeline combining audio separation, adaptive gating, and Apple Silicon-optimized transcription.

### Implementation
**Directory**: `src/processing/pre_processing/per_speaker_transcription/`

**Key Files**:
- `stereo_transcriber.py` - Main pipeline orchestrator
- `audio_gate.py` - Adaptive RMS-based speech detection
- `source_separation.py` - Fast-MNMF blind source separation
- `mlx_transcriber.py` - Apple Silicon-optimized Whisper inference
- `segment_merger.py` - Gap merging and segment consolidation
- `curator_format.py` - Output formatting with deduplication
- `audio_loader.py` - Stereo audio loading
- `config.py` - Pipeline configuration

### When to Use

Use per-speaker transcription instead of standard transcription when:
- The recording has **stereo audio** with dedicated microphones per speaker
- You need **accurate speaker attribution** at the word level
- Standard diarization struggles with overlapping speech

### Input

**Primary**:
- Video file with **stereo audio** (left/right channels map to different speakers)

**Configuration** (`StereoTranscriptionConfig`):
- `whisper_model`: MLX Whisper variant (default: `whisper-large-v3-mlx`)
- `sample_rate`: Target sample rate (default: 16000)
- `min_pause_s`: Minimum silence gap (default: 0.2s)
- `speak_extend_pre_s`: Extend speech backwards (default: 0.1s)
- `speak_extend_post_s`: Extend speech forwards (default: 0.3s)

### Processing Steps (10-Stage Pipeline)

1. **Load Stereo Audio**
   - Extract 2-channel audio from video via FFmpeg
   - Resample to 16kHz

2. **Source Separation (Fast-MNMF)**
   - Apply blind source separation to reduce audio bleed between channels
   - Each channel gets a cleaner version of its primary speaker

3. **Save Separated Audio** (optional)
   - Output separated WAV for annotator reference

4. **Channel-to-Speaker Mapping**
   - Map SPEAKER_00 → visible speaker's channel (left by default)
   - Map SPEAKER_01 → other channel

5. **Adaptive Audio Gating (per channel)**
   - Compute RMS energy over sliding windows
   - Fit KDE (Kernel Density Estimation) to RMS distribution
   - Find threshold at valley between speech/silence peaks using histogram analysis
   - Apply morphological operations: grow regions, remove short spikes, fill gaps

6. **Gap Merging**
   - Merge adjacent speech segments separated by silence < 1.0s
   - Consolidate into contiguous speaker turns

7. **Per-Speaker Transcription (MLX Whisper)**
   - Transcribe each speaker's segments independently
   - Uses MLX Whisper for Apple Silicon optimization (4-8x faster than standard Whisper)
   - Word-level timestamps and confidence scores

8. **Timestamp Correction**
   - Align word timestamps back to absolute video timeline
   - Account for segment boundaries and offsets

9. **Merge and Deduplicate**
   - Combine transcripts from both channels chronologically
   - Remove duplicate words caused by audio bleed (see Deduplication below)

10. **Output in Curator Format**
    - Generate `speech_transcription.json` and `diarization.json`
    - Include processing metadata

### Deduplication Algorithm

Audio bleed means both channels may transcribe the same word. The deduplication step resolves this:

1. Sort all words chronologically
2. For each word, check recent words from the **other** speaker with ≥50% temporal overlap
3. If overlapping words are **similar** (same normalized text or substring):
   - **With audio**: Compare RMS energy in each speaker's channel. Keep the word from the channel with higher energy (speaker was closer to that microphone)
   - **Without audio**: Fall back to confidence score comparison
4. **Different** overlapping words are kept (real interruptions/backchannels)

### Output Format

Produces two files:

**`speech_transcription.json`** (same format as standard transcription):
```json
{
  "metadata": {
    "algorithm": {
      "name": "speech_transcription",
      "model": "whisper-large-v3-mlx",
      "processing_time": 45.2,
      "parameters": {
        "audio_duration": 120.5,
        "speaker_count": 2
      }
    }
  },
  "data": [
    {
      "time_range": {"start": 1.5, "end": 2.0},
      "speech": {
        "word": "hello",
        "speaker": "SPEAKER_00",
        "confidence": 0.95,
        "speech_segment": 0
      }
    }
  ]
}
```

**`diarization.json`** (derived from gate output, not pyannote):
Speaker segments based on audio gate results rather than neural diarization.

### Performance

- **Speed**: 4-8x realtime on Apple Silicon (MLX acceleration)
- **Memory**: 2-4GB RAM
- **Device**: Apple Silicon required (MLX)

### Dependencies

```python
mlx-whisper>=0.4.3
numpy
scipy
torch (for source separation)
```

### Known Limitations

- Requires **stereo audio** with per-speaker microphones
- Apple Silicon only (MLX requirement)
- Source separation quality depends on microphone isolation
- Deduplication uses heuristic similarity matching
- Does not handle >2 speakers

---

## 9. Analyst Report Generation

### Purpose
Generate metrics, progress reports, and visualizations from processed annotation data across multiple sessions and analysts.

### Implementation
**Directory**: `src/analyst_report/`

**Key Files**:
- `cli.py` - Command-line interface
- `report_generator.py` - Report orchestration
- `metrics.py` - Metrics calculations
- `models.py` - Data models
- `data_loader.py` - Quip/Box data loading
- `visualizations.py` - Chart generation
- `config.py` - Configuration

### Input

- **Quip Document**: Processing checklist with session status
- **Box Drive**: Session annotation directories

### Output Files

- `summary.json` - Team-wide metrics
- `per_analyst.json` - Per-analyst breakdown
- `per_analyst.csv` - Summary CSV
- `per_session.csv` - Per-video detailed metrics
- `per_task_type.json` - Metrics by task type
- `category_distribution.json` - Tag counts/durations
- `trends.json` - Weekly trend data
- `charts/` - PNG visualizations

### CLI Usage

```bash
python3 src/analyst_report/cli.py \
    --quip-doc Ph4hAQzHwwaj \
    --box-path /path/to/sessions \
    --output ~/Desktop/analyst_metrics \
    --verbose
```

See [Analyst Report Format](../ANALYST_REPORT_FORMAT.md) for detailed output documentation.

---

## Next Steps

For information about how these algorithms connect and pass data:
- See [Data Flow and Integration](03-data-flow.md)

For practical usage instructions:
- See [Quick Start Guide](04-quick-start.md)
