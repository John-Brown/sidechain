# Algorithm Reference, Part B: Mouth Energy, Diarization, State Annotation

> **Status (2026-09-24):** The algorithm descriptions here (processing steps, parameters, blend-shape weights, state rules, intent taxonomy and prompt) are still the design reference for each stage. The implementation details are from the Phase 0 spike and are historical: `src/processing/...` paths, FaceKitRunner (ARKit, 51 blend shapes), OpenAI/MLX Whisper, Silero VAD v3.1, local CLI usage and output directories. The current implementations are the Modal stages in `workers/ml-pipeline/stages/*.py` (Silero VAD v5, faster-whisper large-v3, MediaPipe FaceLandmarker with 52 blend shapes), documented in [PIPELINE.md](../workers/ml-pipeline/PIPELINE.md); current result shapes live in `packages/shared/src/annotation-types.ts`.

**Parts:** [02a: VAD, transcription, facial tracking](02a-algorithm-reference-vad-transcription-face.md) · [02b: mouth energy, diarization, states](02b-algorithm-reference-mouth-diarization-states.md) · [02c: intents, dependency graph, performance](02c-algorithm-reference-intents-summary.md) · [02d: Phase 0 extras](02d-algorithm-reference-phase0-extras.md)

---

## 4. Mouth Energy Processing

### Purpose
Quantify mouth movement intensity using discriminative facial blend shapes.

### Algorithm
**Discriminative Blend Shape Analysis** - Weighted deviation analysis

### Implementation
**File**: `src/processing/pre_processing/mouth_energy/mouth_energy_processor.py` (Phase 0; current: `workers/ml-pipeline/stages/mouth_energy.py`)

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

> Phase 0 weights. The current stage (`workers/ml-pipeline/stages/mouth_energy.py`, `MOUTH_BLEND_SHAPE_WEIGHTS`) uses the same 10 mouth shapes with normalized weights (jawOpen 0.25, smiles 0.10, dimples/pucker/press 0.08, stretch 0.075) over 100ms windows.

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
**File**: `src/processing/pre_processing/diarization/diarization_processor.py` (Phase 0; current: `workers/ml-pipeline/stages/diarization.py`)

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
   echo "your_token_here" > ~/Library/Application\ Support/Sidechain/huggingfacetoken.txt
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
**File**: `src/processing/state_annotation/speaker_state_generator.py` (Phase 0; current: `workers/ml-pipeline/stages/state_annotation.py`)

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

Previous: [Part A](02a-algorithm-reference-vad-transcription-face.md) · Next: [Part C: intents, dependency graph, performance](02c-algorithm-reference-intents-summary.md)
