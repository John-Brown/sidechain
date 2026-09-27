# Sidechain System Overview

> **Archived 2026-09-24: describes the Phase 0 spike** (`src/processing/`, Swift app, FaceKitRunner). For the current system see [getting-started.md](../../../reference/getting-started.md), [system-flow.md](../../../reference/system-flow.md) and [PIPELINE.md](../../../workers/ml-pipeline/PIPELINE.md).

## What is Sidechain?

Sidechain is a social interaction annotation system that automatically analyzes video recordings to classify human behavior, communication patterns, and expressive intents. The system combines computer vision, audio processing, and AI-powered natural language understanding to generate detailed annotations of conversations.

The core design philosophy is **"AI proposes, humans dispose"**: AI handles scale (processing videos faster than humans could) while humans provide judgment (validating and correcting AI predictions). The 7-stage pipeline, Task Mode constraints, and diagnostic logging all serve this human-AI collaboration model.

## System Components

Sidechain consists of four main components:

### 1. Processing Pipeline (Python)
A multi-stage backend that processes video files through various AI/ML algorithms to extract features and generate annotations.

**Location**: `src/processing/`

**Key Technologies**:
- Python 3.12+ with PyTorch
- FFmpeg for audio/video processing
- Multiple AI models (Whisper, MLX Whisper, Silero-VAD, pyannote.audio, FaceKitRunner)
- LLM integration (Claude/GPT via Anthropic API)
- MLX for Apple Silicon-optimized inference

### 2. Sidechain App (Swift/SwiftUI)
A native macOS application for visualizing, validating, and adjusting the generated annotations.

**Location**: `src/visualization/`

**Key Technologies**:
- Swift 6.2+ with concurrency support
- SwiftUI for UI components
- AVFoundation for video playback
- MVVC (Model-View-ViewModel-Controller) architecture
- Task Mode for crowdsourced annotation workflows

### 3. Analyst Report Generator (Python)
Generates metrics, progress reports, and visualizations from processed annotation data.

**Location**: `src/analyst_report/`

**Key Technologies**:
- Quip API integration for processing checklists
- Box Drive for session data
- matplotlib for chart generation

### 4. LLM Annotation Framework (Python)
Alternative LLM-based annotation pipeline for batch classification.

**Location**: `src/llm_annotation/`

## Seven-Stage Processing Pipeline

The system follows a 7-stage pipeline that alternates between AI processing and human validation:

```
┌─────────────────────────────────────────────────────────────┐
│  STAGE 1: AutoPreprocessing (AI)                            │
│  Extract low-level audio/video features                     │
│  • Voice Activity Detection                                 │
│  • Speech Transcription (standard or per-speaker stereo)    │
│  • Facial Tracking                                          │
│  • Mouth Energy Analysis                                    │
│  • Speaker Diarization                                      │
│  • Per-Speaker Transcription (stereo source separation)     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STAGE 2: TagSessionBounds (Human)                          │
│  Mark session boundaries and exclusion ranges               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STAGE 3: StateProcessing (AI)                              │
│  Generate speaker state annotations                         │
│  • Convert diarization to speaking/listening states         │
│  • Create time-aligned state segments                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STAGE 4: VerifyStates (Human)                              │
│  Validate and correct AI-generated state annotations        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STAGE 5: IntentProcessing (AI)                             │
│  Classify expressive intents using LLMs                     │
│  • Extract speech chunks from state boundaries              │
│  • Use context-aware LLM classification                     │
│  • Generate intent, intensity, and valence labels           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STAGE 6: VerifyIntents (Human)                             │
│  Validate and correct AI-generated intent labels            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STAGE 7: TagBackchannels (Human)                           │
│  Annotate listener feedback and backchannel events          │
└─────────────────────────────────────────────────────────────┘
```

Stages 1, 3, and 5 are automated (AI). Stages 2, 4, 6, and 7 are human validation/annotation performed in the Sidechain App, often via Task Mode for crowdsourcing.

## Data Flow Overview

```
Video File (.mp4, .mov, etc.)
    ↓
[Processing Pipeline]
    ↓
JSON Annotation Files
    ├── voice_activity.json
    ├── speech_transcription.json
    ├── facial_tracking.json
    ├── mouth_energy.json
    ├── diarization.json
    ├── annotations.json
    ├── intent_classification_annotations.json
    ├── annotation_saves.json          (diagnostic log)
    └── processing_summary.json
    ↓
[Sidechain App]
    ↓
Visual Timeline + Validation UI (Task Mode)
    ↓
Corrected/Validated Annotations
    ↓
[Analyst Report Generator]
    ↓
Metrics, Charts, Progress Reports
```

## Key Features

### Automated Multi-Modal Analysis
- **Audio**: Voice activity, speech transcription, speaker identification
- **Video**: Facial tracking with 51 blend shapes, head pose, gaze direction
- **Integration**: Combines audio and visual cues for robust speaker detection
- **Per-Speaker Transcription**: Stereo source separation with energy-based deduplication

### Unified Annotation Format
All outputs follow a consistent JSON schema with metadata and time-aligned data:

```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "algorithm": {
      "name": "...",
      "processing_time": 12.3
    }
  },
  "data": [
    {"time": 1.25, ...},
    {"time_range": {"start": 1.5, "end": 2.0}, ...}
  ]
}
```

### Flexible Processing Options
- Run full pipeline or individual stages
- Standard transcription (mono, OpenAI Whisper) or per-speaker (stereo, MLX Whisper)
- Configure model parameters and quality settings
- Support for audio exclusions (mute specific time ranges)
- Device optimization (MPS/CUDA/CPU)

### Visual Validation & Task Mode
- Interactive timeline view of all annotations
- Synchronized video playback
- Editable speech transcripts with drag-to-resize word blocks
- Correction and adjustment tools with undo/redo
- Task Mode for crowdsourced annotation with constraints and editable ranges
- Input activity monitoring and task completion metrics
- Diagnostic logging (`annotation_saves.json`) for forensic tracking

## Supported Media Formats

**Input**: MP4, MOV, AVI, MKV, WebM, M4V

**Audio Requirements**: Any format supported by FFmpeg (automatically converted to 16kHz PCM)

**Video Requirements**: Any resolution (can be scaled for faster processing)

## Processing Speed

| Stage | Typical Speed | Notes |
|-------|---------------|-------|
| Voice Activity Detection | 2-5x realtime | Very fast, CPU-only |
| Speech Transcription (Whisper) | ~1x realtime | GPU acceleration helps |
| Per-Speaker Transcription (MLX) | 4-8x realtime | Apple Silicon optimized |
| Facial Tracking | 4-20x realtime | Scalable with resolution/FPS |
| Mouth Energy | Instant | Post-processing only |
| Speaker Diarization | ~0.3x realtime | Slowest stage, benefits from GPU |
| State Annotation | Instant | Rule-based conversion |
| Intent Classification | Variable | Depends on API rate limits |

**Example**: A 10-minute video typically processes in 30-40 minutes end-to-end.

## Hardware Requirements

### Minimum
- **CPU**: Multi-core processor (Intel/Apple Silicon)
- **RAM**: 8GB
- **Storage**: 5GB for models + video storage
- **OS**: macOS 15+ (for Sidechain App and FaceKit)

### Recommended
- **CPU**: Apple Silicon M1/M2/M3/M4 (for MPS acceleration and MLX)
- **RAM**: 16GB+
- **Storage**: 20GB+ for models and working data
- **GPU**: Metal Performance Shaders (MPS) for diarization

### Cloud Processing
- Can run processing pipeline on Linux with CUDA
- Sidechain App requires macOS for visualization

## Project Structure

```
Sidechain/
├── src/
│   ├── processing/                  # Python processing pipeline
│   │   ├── processor.py             # Main CLI dispatcher
│   │   ├── process_directory.py     # Batch processing
│   │   ├── simple_processing_server.py  # HTTP server mode
│   │   ├── setup_models.py          # Model downloader
│   │   ├── json_utils.py            # JSON utilities + annotation_saves
│   │   ├── path_utils.py            # FaceKitRunner path discovery
│   │   ├── pre_processing/          # Stage 1: raw feature extraction
│   │   │   ├── voice_activity/
│   │   │   ├── speech_transcription/
│   │   │   ├── facial_tracking/
│   │   │   ├── mouth_energy/
│   │   │   ├── diarization/
│   │   │   ├── per_speaker_transcription/
│   │   │   ├── video_normalization.py
│   │   │   ├── time_validation.py
│   │   │   └── audio_exclusion.py
│   │   ├── state_annotation/        # Stage 3: state generation
│   │   └── intent_annotation/       # Stage 5: LLM classification
│   ├── visualization/               # Swift Sidechain App
│   │   └── Sources/VideoVisualizer/
│   │       ├── VideoVisualizerApp.swift
│   │       ├── ContentView.swift
│   │       ├── AnnotationTracks/    # Track renderers
│   │       ├── Timeline/           # Timeline components
│   │       ├── TaskMode/           # Crowdsourcing system
│   │       ├── Services/           # Network + file I/O
│   │       ├── AnnotationDefinitions/  # Tag schema editor
│   │       ├── UI/                 # Reusable components
│   │       └── ...
│   ├── analyst_report/              # Metrics and reporting
│   └── llm_annotation/             # Alternative LLM pipeline
├── docs/
│   ├── architecture/                # System documentation
│   ├── PROJECT_INSIGHTS.md          # Design philosophy
│   ├── ANALYST_REPORT.md
│   └── ANALYST_REPORT_FORMAT.md
├── tests/                           # Python tests
├── bin/                             # FaceKitRunner binary
└── requirements.txt
```

## Getting Started

See [getting-started.md](../../../reference/getting-started.md) for installation and setup instructions.

For detailed algorithm information, see:
- [Algorithm Reference](../../../reference/02a-algorithm-reference-vad-transcription-face.md)
- [Data Flow and Integration](03-data-flow.md)
- [Quick Start Guide](04-quick-start.md)

For project philosophy and design decisions:

## License and Models

This project uses several open-source and commercial models:
- **Silero-VAD**: MIT License
- **Whisper**: MIT License (OpenAI)
- **MLX Whisper**: MIT License (Apple Silicon optimized)
- **pyannote.audio**: MIT License (requires HuggingFace agreement)
- **FaceKitRunner**: Apple ARKit (macOS only)
- **Claude/GPT**: Commercial APIs (via Anthropic API)

See individual algorithm documentation for specific licensing details.
