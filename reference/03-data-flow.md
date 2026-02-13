# Data Flow and Integration

This document explains how data flows through the Sidechain system, how algorithms connect, and how to work with the unified annotation format.

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [Data Dependencies](#data-dependencies)
3. [Unified Annotation Format](#unified-annotation-format)
4. [Integration Patterns](#integration-patterns)
5. [File Organization](#file-organization)
6. [Time Alignment](#time-alignment)
7. [Diagnostic Logging](#diagnostic-logging)
8. [Working with Annotations](#working-with-annotations)

---

## Pipeline Overview

The Sidechain processing pipeline follows a **staged data flow** where outputs from earlier stages become inputs to later stages.

### Seven-Stage Architecture

The full pipeline alternates between AI processing (automated) and human validation:

```
┌──────────────────────────────────────────────────────────┐
│ STAGE 1: AutoPreprocessing (AI)                          │
│ Independent algorithms extracting low-level features     │
└──────────────────────────────────────────────────────────┘
    ↓ Produces: voice_activity.json
    ↓           speech_transcription.json
    ↓           facial_tracking.json
    ↓           mouth_energy.json
    ↓           diarization.json

┌──────────────────────────────────────────────────────────┐
│ STAGE 2: TagSessionBounds (Human)                        │
│ Mark session boundaries, exclusion ranges                │
└──────────────────────────────────────────────────────────┘
    ↓ Modifies: annotations.json (session.exclude ranges)

┌──────────────────────────────────────────────────────────┐
│ STAGE 3: StateProcessing (AI)                            │
│ Converts diarization to speaking/listening states        │
└──────────────────────────────────────────────────────────┘
    ↓ Produces: annotations.json (expression.state.*)

┌──────────────────────────────────────────────────────────┐
│ STAGE 4: VerifyStates (Human)                            │
│ Validate and correct AI-generated states                 │
└──────────────────────────────────────────────────────────┘
    ↓ Modifies: annotations.json

┌──────────────────────────────────────────────────────────┐
│ STAGE 5: IntentProcessing (AI)                           │
│ Classifies intents using state boundaries + transcripts  │
└──────────────────────────────────────────────────────────┘
    ↓ Produces: intent_classification_annotations.json

┌──────────────────────────────────────────────────────────┐
│ STAGE 6: VerifyIntents (Human)                           │
│ Validate and correct intent labels                       │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ STAGE 7: TagBackchannels (Human)                         │
│ Annotate listener feedback and backchannel events        │
└──────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Modularity**: Each algorithm is independent within its stage
2. **Idempotency**: Can re-run individual stages without affecting others
3. **Caching**: Outputs cached for fast re-processing
4. **Validation**: All outputs validated for time coverage and format
5. **Human-in-the-loop**: AI proposes, humans validate at each stage boundary

---

## Data Dependencies

### Dependency Graph (Standard Pipeline)

```
video_file.mp4
    │
    ├─→ [VAD] ──────────────────────────────────────┐
    │      ↓                                         │
    │   voice_activity.json                         │
    │                                                ↓
    ├─→ [Speech Transcription] ────────┐      [Diarization]
    │      ↓                            │            ↓
    │   speech_transcription.json      │     diarization.json
    │                                   │            ↓
    ├─→ [Facial Tracking] ─────────────┤    [State Annotation]
    │      ↓                            │            ↓
    │   facial_tracking.json           │     annotations.json
    │      ↓                            │            │
    │   [Mouth Energy] ────────────────┤            │
    │      ↓                            │            │
    │   mouth_energy.json ─────────────┘            │
    │                                                │
    └────────────────────────────────────────────────┘
                                                     ↓
                                          [Intent Classification]
                                                     ↓
                                          intent_classification_annotations.json
```

### Alternative: Per-Speaker Transcription Pipeline

For stereo recordings with per-speaker microphones:

```
video_file.mp4 (stereo)
    │
    ├─→ [Source Separation] ──→ [Audio Gate L] ──→ [MLX Whisper L]
    │                      └──→ [Audio Gate R] ──→ [MLX Whisper R]
    │                                                    │
    │                                          [Merge + Deduplicate]
    │                                                    ↓
    │                                    speech_transcription.json
    │                                    diarization.json
    │
    ├─→ [Facial Tracking] ──→ [Mouth Energy]
    │
    └─→ [VAD] ──→ voice_activity.json
```

This replaces both standard transcription and standard diarization with a single integrated pipeline.

### Algorithm Dependencies

#### Stage 1: Raw Preprocessing

| Algorithm | Required Inputs | Optional Inputs | Outputs |
|-----------|----------------|-----------------|---------|
| VAD | video_file | exclusion_ranges | voice_activity.json |
| Speech Transcription | video_file | - | speech_transcription.json |
| Facial Tracking | video_file | - | facial_tracking.json |
| Mouth Energy | facial_tracking.json | - | mouth_energy.json |
| Diarization | video_file | voice_activity.json, mouth_energy.json | diarization.json |
| Per-Speaker Transcription | video_file (stereo) | - | speech_transcription.json, diarization.json |

**Key Points**:
- All Stage 1 algorithms can run in parallel except:
  - Mouth Energy requires Facial Tracking first
- Diarization works standalone but is enhanced by VAD and Mouth Energy
- Per-Speaker Transcription replaces both standard Transcription and Diarization

#### Stage 3: State Annotation

| Algorithm | Required Inputs | Outputs |
|-----------|----------------|---------|
| State Annotation | diarization.json | annotations.json |

#### Stage 5: Intent Classification

| Algorithm | Required Inputs | Outputs |
|-----------|----------------|---------|
| Intent Classification | annotations.json, speech_transcription.json, voice_activity.json | intent_classification_annotations.json |

---

## Unified Annotation Format

All algorithm outputs follow the same JSON structure for consistency and interoperability. JSON files use alphabetically sorted keys.

### Schema Structure

```json
{
  "metadata": {
    "source_file": "string",
    "format_version": "string",
    "created_timestamp": "ISO8601 datetime (UTC, Z suffix)",
    "total_secs": "float",
    "video_width": "int (optional)",
    "video_height": "int (optional)",
    "algorithm": {
      "name": "string",
      "model": "string (optional)",
      "version": "string (optional)",
      "processing_time": "float (required)",
      "parameters": {}
    }
  },
  "data": [
    {
      "time": "float (for point-in-time data)",
      "time_range": {
        "start": "float",
        "end": "float"
      },
      "<algorithm_specific_key>": {
        // Algorithm-specific data
      }
    }
  ]
}
```

### Temporal Data Types

**Point-in-Time Data** (uses `time` field):
- Facial tracking (per-frame)
- Example: `{"time": 1.25, "facial_tracking": {...}}`

**Time Range Data** (uses `time_range` field):
- Voice activity (windowed)
- Speech transcription (word spans)
- Diarization (speaker segments)
- State annotations
- Intent classifications
- Example: `{"time_range": {"start": 1.0, "end": 2.5}, "diarization": {...}}`

### Algorithm-Specific Keys

Each algorithm adds its data under a unique key:

| Algorithm | Data Key | Type |
|-----------|----------|------|
| VAD | `voice_activity` | time_range |
| Speech Transcription | `speech` | time_range |
| Facial Tracking | `facial_tracking` | time (point) |
| Mouth Energy | `mouth_energy` | time_range |
| Diarization | `diarization` | time_range |
| State Annotation | `category` + `note` | time_range |
| Intent Classification | `intent_classification` | time_range |

### Speaker ID Convention

Speaker IDs use **0-based numbering**: `SPEAKER_00`, `SPEAKER_01`, etc.

- `SPEAKER_00` is the visible speaker (person on camera) when detectable
- `EXCLUDED_RANGE` is used for excluded time ranges in diarization

### Example Files

#### voice_activity.json
```json
{
  "metadata": {...},
  "data": [
    {
      "time_range": {"start": 0.0, "end": 0.1},
      "voice_activity": {
        "speech_probability": 0.12,
        "energy_dbfs": -42.3,
        "energy_dbfs_left": -41.5,
        "energy_dbfs_right": -43.1
      }
    }
  ]
}
```

#### speech_transcription.json
```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "algorithm": {
      "name": "speech_transcription",
      "model": "whisper-large-v3-mlx",
      "processing_time": 45.2,
      "parameters": {
        "audio_duration": 30.5,
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

#### diarization.json
```json
{
  "metadata": {
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
    "audio_channel_speaker_probability": {
      "left": {"SPEAKER_00": 0.98},
      "right": {"SPEAKER_01": 0.99}
    },
    "audio_channel_detection_status": "SUCCESS",
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
      "time_range": {"start": 0.0, "end": 5.2},
      "diarization": {"speaker": "SPEAKER_00"}
    },
    {
      "time_range": {"start": 5.2, "end": 8.7},
      "diarization": {"speaker": "SPEAKER_01"}
    },
    {
      "time_range": {"start": 30.0, "end": 35.0},
      "diarization": {"speaker": "EXCLUDED_RANGE"}
    }
  ]
}
```

#### facial_tracking.json
```json
{
  "metadata": {...},
  "data": [
    {
      "time": 0.033,
      "facial_tracking": {
        "tracking": {
          "blendshapes": [0.1, 0.2, ...],
          "head_pose": {...},
          "gaze_direction": [...],
          "landmarks": [...],
          "confidence": 0.95,
          "face_detected": true
        }
      }
    }
  ]
}
```

#### annotations.json (State Annotations)
```json
{
  "metadata": {...},
  "data": [
    {
      "time_range": {"start": 0.0, "end": 5.2},
      "category": "expression.state.speaking",
      "note": "Visible speaker SPEAKER_00",
      "parameters": {}
    }
  ]
}
```

---

## Integration Patterns

### Pattern 1: Full Pipeline

Process all stages using the unified processor:

```bash
python3 src/processing/processor.py video.mov \
    --process-raw --process-states --process-intents --verbose
```

### Pattern 2: Selective Processing

Run only specific components:

```bash
# Raw preprocessing only (no states or intents)
python3 src/processing/processor.py video.mov --process-raw

# Skip specific algorithms
python3 src/processing/processor.py video.mov --process-raw \
    --no-raw-facial-tracking --no-raw-mouth-energy

# States only (requires existing diarization.json)
python3 src/processing/processor.py video.mov --process-states

# Intents only (requires existing annotations + transcription)
python3 src/processing/processor.py video.mov --process-intents
```

### Pattern 3: Per-Speaker Transcription

For stereo recordings:

```bash
python3 src/processing/processor.py video.mov --process-raw \
    --per-speaker-transcription --verbose
```

This replaces standard transcription and diarization with the integrated stereo pipeline.

### Pattern 4: Batch Processing

Process entire directories:

```bash
python3 src/processing/process_directory.py --dir /path/to/videos \
    --skip-existing --verbose
```

---

## File Organization

### Standard Output Directory Structure

```
video_name_annotations/
├── voice_activity.json                  # VAD output (10Hz)
├── speech_transcription.json            # Whisper output (word-level)
├── speech_transcription_original.json   # Pre-deduplication backup (per-speaker only)
├── facial_tracking.json                 # FaceKit output (10-30 FPS)
├── mouth_energy.json                    # Mouth movement (10Hz)
├── diarization.json                     # Speaker segments
├── annotations.json                     # State annotations (human-editable)
├── intent_classification_annotations.json  # Intent labels
├── annotation_saves.json               # Diagnostic save log
├── processing_summary.json             # Pipeline metadata
└── separated_audio.wav                 # Source-separated audio (per-speaker only)
```

### File Naming Convention

**Base Pattern**: `{algorithm_name}.json`

The output directory is created automatically as `{video_name}_annotations/` next to the video file, or specified via `--output`.

### Processing Summary

The `processing_summary.json` file tracks pipeline execution:

```json
{
  "video_path": "session.mov",
  "output_directory": "/path/to/output",
  "processing_start_time": 1705250000.0,
  "components_processed": ["voice_activity", "speech_transcription", "diarization"],
  "components_skipped": ["facial_tracking", "mouth_energy"],
  "errors": [],
  "processing_end_time": 1705250125.0,
  "total_processing_time": 125.3
}
```

---

## Time Alignment

### Coordinate System

All timestamps use **seconds** as the unit, with **floating-point precision**.

**Reference**: Video start time = 0.0 seconds

### Time Range Semantics

Time ranges use **inclusive start, exclusive end** (half-open interval):

```
time_range: {"start": 1.0, "end": 2.0}
Includes: [1.0, 2.0)
Duration: 1.0 second
```

**Adjacent ranges** have no gap:
```json
[
  {"time_range": {"start": 0.0, "end": 5.0}},
  {"time_range": {"start": 5.0, "end": 8.0}}
]
```

### Sampling Rates

Different algorithms produce data at different rates:

| Algorithm | Rate | Interval | Example Time Points |
|-----------|------|----------|---------------------|
| VAD | 10Hz | 100ms | 0.0, 0.1, 0.2, 0.3, ... |
| Facial Tracking | 10-30 FPS | 33-100ms | 0.0, 0.033, 0.067, ... |
| Mouth Energy | 10Hz | 100ms | 0.0, 0.1, 0.2, 0.3, ... |
| Transcription | Variable | Per word | 0.5, 0.8, 1.2, ... |
| Diarization | Variable | Per segment | 0.0-5.2, 5.2-8.7, ... |

### Time Alignment Strategies

**1. Nearest Neighbor** (for point-in-time queries):
```python
def get_facial_data_at_time(facial_data, query_time):
    closest = min(facial_data, key=lambda x: abs(x['time'] - query_time))
    return closest
```

**2. Range Overlap** (for time range queries):
```python
def get_overlapping_annotations(annotations, start, end):
    return [
        ann for ann in annotations
        if ann['time_range']['start'] < end and ann['time_range']['end'] > start
    ]
```

**3. Interpolation** (for smooth data):
```python
def interpolate_vad_at_time(vad_data, query_time):
    before = [v for v in vad_data if v['time_range']['end'] <= query_time]
    after = [v for v in vad_data if v['time_range']['start'] >= query_time]
    if not before or not after:
        return None
    v1, v2 = before[-1], after[0]
    t1, t2 = v1['time_range']['end'], v2['time_range']['start']
    alpha = (query_time - t1) / (t2 - t1)
    return (1 - alpha) * v1['voice_activity']['speech_probability'] + \
           alpha * v2['voice_activity']['speech_probability']
```

### Time Coverage Validation

All algorithms validate that outputs cover the full video duration:

```python
def validate_time_coverage(data, total_duration, tolerance=0.1):
    if data[0]['time_range']['start'] > tolerance:
        raise ValueError(f"Data starts late at {data[0]['time_range']['start']}")
    if data[-1]['time_range']['end'] < total_duration - tolerance:
        raise ValueError(f"Data ends early at {data[-1]['time_range']['end']}")
    for i in range(len(data) - 1):
        gap = data[i+1]['time_range']['start'] - data[i]['time_range']['end']
        if gap > tolerance:
            raise ValueError(f"Gap detected at {data[i]['time_range']['end']}")
```

---

## Diagnostic Logging

### annotation_saves.json

Every annotation save is logged to `annotation_saves.json` for forensic tracking across machines and processes. This is implemented in `src/processing/json_utils.py`.

```json
{
  "saves": [
    {
      "save_timestamp": "2025-01-14 15:30:00 PT",
      "reason": "processing",
      "machine_id": "a1b2c3",
      "video_path": "relative/path/to/video.mov",
      "annotation_count": 42,
      "annotations_path": "parent/annotations_dir",
      "algorithm": "state_annotation_generator"
    }
  ]
}
```

**Fields**:
- `save_timestamp`: Cupertino timezone timestamp
- `reason`: `"processing"`, `"user_edit"`, or `"task_complete"`
- `machine_id`: SHA-256 hash of hostname (first 6 chars)
- `annotation_count`: Number of annotations in the save
- `algorithm`: Which algorithm triggered the save (optional)

The log retains the last 100 entries to prevent unbounded growth.

---

## Working with Annotations

### Loading Annotations

```python
import json
from pathlib import Path

def load_annotation_file(file_path):
    with open(file_path, 'r') as f:
        data = json.load(f)
    assert 'metadata' in data
    assert 'data' in data
    return data

annotations_dir = Path("video_annotations")
vad_data = load_annotation_file(annotations_dir / "voice_activity.json")
transcription_data = load_annotation_file(annotations_dir / "speech_transcription.json")
diarization_data = load_annotation_file(annotations_dir / "diarization.json")
```

### Filtering Annotations

```python
def filter_by_speaker(diarization_data, speaker_id):
    return [
        d for d in diarization_data['data']
        if d['diarization']['speaker'] == speaker_id
    ]

def filter_by_time_range(data, start_time, end_time):
    return [
        item for item in data['data']
        if ('time' in item and start_time <= item['time'] < end_time) or
           ('time_range' in item and
            item['time_range']['start'] < end_time and
            item['time_range']['end'] > start_time)
    ]

def filter_by_intent(intent_data, intent_type):
    return [
        i for i in intent_data['data']
        if i['intent_classification']['intent'] == intent_type
    ]
```

### Exporting to DataFrame

```python
import pandas as pd

def annotations_to_dataframe(annotation_file):
    data = load_annotation_file(annotation_file)
    rows = []
    for item in data['data']:
        row = {
            'start': item.get('time_range', {}).get('start'),
            'end': item.get('time_range', {}).get('end'),
            'time': item.get('time')
        }
        for key, value in item.items():
            if key not in ['time', 'time_range']:
                if isinstance(value, dict):
                    for subkey, subvalue in value.items():
                        row[f"{key}.{subkey}"] = subvalue
                else:
                    row[key] = value
        rows.append(row)
    return pd.DataFrame(rows)
```

---

## Best Practices

1. **Always validate time coverage** after generating annotations
2. **Handle missing data gracefully** — not all algorithms may have run
3. **Use appropriate time alignment** — nearest neighbor for points, overlap for ranges
4. **Preserve metadata** for reproducibility
5. **Check annotation_saves.json** when debugging unexpected annotation changes
6. **Use 0-based speaker IDs** — `SPEAKER_00` is the visible speaker

---

## Next Steps

For practical usage instructions:
- See [Quick Start Guide](04-quick-start.md)

For detailed algorithm information:
- See [Algorithm Reference](02-algorithm-reference.md)

For system overview:
- See [System Overview](01-system-overview.md)
