# Quick Start Guide

This guide helps you get started with the Sidechain processing pipeline and visualization app.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Processing Your First Video](#processing-your-first-video)
4. [Understanding the Output](#understanding-the-output)
5. [Using the Sidechain App](#using-the-sidechain-app)
6. [Common Workflows](#common-workflows)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

**Operating System**:
- **macOS 15+** (required for Sidechain App and FaceKit)
- **Linux** (for processing pipeline only, no visualization)

**Hardware**:
- **CPU**: Multi-core processor (Apple Silicon recommended)
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 20GB+ for models and working data
- **GPU**: Optional but recommended (MPS on Apple Silicon, CUDA on NVIDIA)

### Software Dependencies

**Python**:
- Python 3.12+
- pip for package management

**System Tools**:
- FFmpeg (for audio/video processing)
- Git (for cloning repository)

**macOS Specific**:
- Xcode Command Line Tools
- Swift 6.2+ (for building Sidechain App)

---

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url> Sidechain
cd Sidechain
```

### 2. Set Up Python Environment

```bash
# Create virtual environment with Python 3.12+
python3.12 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

**Note**: `requirements.txt` pins `torch>=2.8.0,<2.9.0` and `torchaudio>=2.8.0,<2.9.0` due to a compatibility issue with silero-vad (torchaudio 2.9+ removed `list_audio_backends()`).

### 3. Install System Dependencies

**macOS** (using Homebrew):
```bash
brew install ffmpeg python@3.12
xcode-select --install
```

### 4. Download Required Models

Most models download automatically on first use. Use the setup script to download all at once:

```bash
python3 src/processing/setup_models.py
```

**pyannote.audio** (for diarization) requires manual setup:
1. Create HuggingFace account at https://huggingface.co
2. Accept model agreement: https://huggingface.co/pyannote/speaker-diarization-community-1
3. Generate access token: https://huggingface.co/settings/tokens
4. Save token to file:
   ```bash
   mkdir -p ~/Library/Application\ Support/Sidechain
   echo "your_token_here" > ~/Library/Application\ Support/Sidechain/huggingfacetoken.txt
   ```

### 5. Set Up FaceKitRunner (macOS only)

```bash
# Remove quarantine attribute
sudo xattr -d com.apple.quarantine bin/FaceKitRunner-macOS/FaceKitRunner-macOS

# Make executable
chmod +x bin/FaceKitRunner-macOS/FaceKitRunner-macOS
```

### 6. Configure LLM API (for Intent Classification)

Sidechain uses Anthropic SDK for API access:

```bash
# The Anthropic API endpoint is configured internally:
# https://api.anthropic.com
# Authentication is handled by the Anthropic SDK
```

No manual API key configuration is needed for internal use.

---

## Processing Your First Video

### Basic Processing

Process a video with default settings:

```bash
# Activate virtual environment
source venv/bin/activate

# Run full pipeline
python3 src/processing/processor.py path/to/video.mov \
    --process-raw --process-states --process-intents --verbose
```

This will:
1. Run all Stage 1 algorithms (VAD, transcription, facial tracking, etc.)
2. Generate state annotations
3. Classify intents using LLM
4. Save all outputs to `video_annotations/` directory (next to the video)

### Processing Modes

**Raw preprocessing only** (fastest, no LLM calls):
```bash
python3 src/processing/processor.py video.mov --process-raw
```

**States only** (requires existing diarization.json):
```bash
python3 src/processing/processor.py video.mov --process-states
```

**Intents only** (requires existing annotations + transcription):
```bash
python3 src/processing/processor.py video.mov --process-intents
```

### Skipping Specific Algorithms

```bash
# Skip facial tracking and mouth energy (audio-only analysis)
python3 src/processing/processor.py video.mov --process-raw \
    --no-raw-facial-tracking --no-raw-mouth-energy

# Skip diarization (if already exists)
python3 src/processing/processor.py video.mov --process-raw \
    --no-raw-diarization
```

### Per-Speaker Transcription (Stereo Recordings)

For recordings with per-speaker microphones on separate stereo channels:

```bash
python3 src/processing/processor.py video.mov --process-raw \
    --per-speaker-transcription --verbose
```

This uses source separation + MLX Whisper instead of standard Whisper + pyannote diarization. Requires Apple Silicon.

### Processing Options

```bash
python3 src/processing/processor.py video.mov --process-raw \
    --num-participants 2 \           # Override speaker count hint
    --output /custom/output/dir \    # Custom output directory
    --clean \                        # Delete existing output first
    --whisper-model whisper-large-v3-turbo \  # Faster Whisper variant
    --verbose
```

### Custom Output Directory

```bash
python3 src/processing/processor.py video.mov --process-raw \
    --output ~/Desktop/my_annotations
```

---

## Understanding the Output

After processing, your output directory will contain:

```
video_annotations/
├── voice_activity.json                  # 10Hz voice detection + audio energy
├── speech_transcription.json            # Word-level transcription with timestamps
├── facial_tracking.json                 # Frame-by-frame facial features (51 blendshapes)
├── mouth_energy.json                    # 10Hz mouth movement quantification
├── diarization.json                     # Speaker segments with metadata
├── annotations.json                     # Speaking/listening state annotations
├── intent_classification_annotations.json  # Intent, intensity, valence per segment
├── annotation_saves.json               # Diagnostic save log
└── processing_summary.json             # Pipeline execution metadata
```

For per-speaker transcription, additionally:
```
├── speech_transcription_original.json   # Pre-deduplication backup
└── separated_audio.wav                 # Source-separated stereo audio
```

### Quick Inspection

```bash
# View file metadata
cat video_annotations/voice_activity.json | jq '.metadata'

# Count annotations
cat video_annotations/diarization.json | jq '.data | length'

# Get all speaker IDs
cat video_annotations/diarization.json | jq '.data[].diarization.speaker' | sort -u

# Get all intent types
cat video_annotations/intent_classification_annotations.json | jq '.data[].intent_classification.intent' | sort -u
```

### File Sizes

Typical file sizes for a 10-minute video:

| File | Size | Notes |
|------|------|-------|
| voice_activity.json | ~500KB | 10Hz x 600s = 6000 entries |
| speech_transcription.json | ~100KB | Variable (depends on speech density) |
| facial_tracking.json | ~15MB | 30 FPS x 600s x 51 blendshapes |
| mouth_energy.json | ~300KB | 10Hz x 600s = 6000 entries |
| diarization.json | ~50KB | Variable (depends on speaker turns) |
| annotations.json | ~30KB | One per speaker segment |
| intent_classification_annotations.json | ~80KB | One per speech segment |

---

## Using the Sidechain App

The Sidechain App is a native macOS application for visualizing and validating annotations.

### Building the App

```bash
cd src/visualization
swift build --disable-sandbox

# Or for release build
swift build --disable-sandbox -c release
```

### Launching the App

```bash
cd src/visualization
swift run --disable-sandbox

# With debug logging
swift run --disable-sandbox Sidechain --debug
```

### Loading Video and Annotations

1. **Launch Sidechain App**
2. **Load Video**: File > Open Video
3. **Load Annotations**: File > Load Annotations Directory
4. **Select Directory**: Choose `video_annotations/` folder

### Key Features

- **Timeline View**: Multi-track visualization of all annotation types
- **Speech Transcription**: Editable word blocks with drag-to-resize
- **Annotation Editor**: Edit tags, adjust boundaries, add notes
- **Task Mode**: Crowdsourced annotation with constraints and editable ranges
- **Undo/Redo**: Full edit history
- **Keyboard Shortcuts**: Efficient navigation and editing

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Space** | Play/Pause video |
| **Left/Right** | Seek backward/forward 1 second |
| **Shift+Left/Right** | Seek backward/forward 5 seconds |
| **Cmd+O** | Open video file |
| **Cmd+S** | Save current state |

---

## Common Workflows

### Workflow 1: Quick Audio-Only Analysis

Fast processing without video analysis:

```bash
python3 src/processing/processor.py video.mov --process-raw \
    --no-raw-facial-tracking --no-raw-mouth-energy \
    --verbose
```

### Workflow 2: Full Pipeline

Maximum quality for research:

```bash
python3 src/processing/processor.py video.mov \
    --process-raw --process-states --process-intents \
    --num-participants 2 --verbose
```

### Workflow 3: Batch Processing

Process multiple videos:

```bash
python3 src/processing/process_directory.py \
    --dir /path/to/videos \
    --skip-existing \
    --verbose
```

### Workflow 4: Per-Speaker Stereo Pipeline

For recordings with per-speaker mics:

```bash
python3 src/processing/processor.py video.mov --process-raw \
    --per-speaker-transcription --verbose

# Then add states and intents
python3 src/processing/processor.py video.mov \
    --process-states --process-intents
```

### Workflow 5: Analyst Reports

Generate metrics from processed sessions:

```bash
python3 src/analyst_report/cli.py \
    --quip-doc Ph4hAQzHwwaj \
    --box-path /path/to/sessions \
    --output ~/Desktop/analyst_metrics \
    --verbose
```

---

## Troubleshooting

### Common Issues

#### Issue: "FFmpeg not found"

```bash
brew install ffmpeg
ffmpeg -version
```

#### Issue: "HuggingFace token not set"

```bash
# Save token to the expected file location
mkdir -p ~/Library/Application\ Support/Sidechain
echo "your_token_here" > ~/Library/Application\ Support/Sidechain/huggingfacetoken.txt

# Or set environment variable (fallback)
export HUGGING_FACE_TOKEN="your_token_here"
```

#### Issue: "FaceKitRunner permission denied"

```bash
sudo xattr -d com.apple.quarantine bin/FaceKitRunner-macOS/FaceKitRunner-macOS
chmod +x bin/FaceKitRunner-macOS/FaceKitRunner-macOS
```

#### Issue: "Out of memory during processing"

```bash
# Skip heavy algorithms
python3 src/processing/processor.py video.mov --process-raw \
    --no-raw-facial-tracking --no-raw-mouth-energy

# Or process stages separately
python3 src/processing/processor.py video.mov --process-raw \
    --no-raw-diarization
python3 src/processing/processor.py video.mov --process-raw \
    --no-raw-vad --no-raw-speech-transcription \
    --no-raw-facial-tracking --no-raw-mouth-energy
```

#### Issue: "Diarization very slow"

```bash
# Check GPU acceleration
python3 -c "import torch; print('MPS:', torch.backends.mps.is_available())"
python3 -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

#### Issue: "torch/torchaudio version conflict"

The project pins `torch>=2.8.0,<2.9.0` because `torchaudio 2.9+` removed `list_audio_backends()` which silero-vad still calls. If you see import errors, ensure you're using the pinned versions:

```bash
pip install torch>=2.8.0,<2.9.0 torchaudio>=2.8.0,<2.9.0
```

### Debugging

```bash
# Verbose processing output
python3 src/processing/processor.py video.mov --process-raw --verbose

# Sidechain app with debug logging
cd src/visualization && swift run --disable-sandbox Sidechain --debug
```

---

## Command Reference

### Processing Commands

```bash
# Full pipeline
python3 src/processing/processor.py VIDEO --process-raw --process-states --process-intents

# Raw preprocessing only
python3 src/processing/processor.py VIDEO --process-raw

# Per-speaker (stereo)
python3 src/processing/processor.py VIDEO --process-raw --per-speaker-transcription

# With options
python3 src/processing/processor.py VIDEO --process-raw \
    --output DIR \
    --num-participants 2 \
    --clean \
    --verbose

# Batch processing
python3 src/processing/process_directory.py --dir DIR --skip-existing --verbose
```

### Sidechain App Commands

```bash
# Build
cd src/visualization && swift build --disable-sandbox

# Run
cd src/visualization && swift run --disable-sandbox

# With debug
cd src/visualization && swift run --disable-sandbox Sidechain --debug

# Release build
cd src/visualization && swift build --disable-sandbox -c release
```

### Analyst Report Commands

```bash
python3 src/analyst_report/cli.py \
    --quip-doc DOC_ID \
    --box-path /path/to/sessions \
    --output ~/Desktop/report \
    --verbose
```

---

## Next Steps

### Learn More

- [System Overview](01-system-overview.md) - Understand the architecture
- [Algorithm Reference](02-algorithm-reference.md) - Deep dive into each algorithm
- [Data Flow and Integration](03-data-flow.md) - Learn about data formats and integration
- [Project Insights](../PROJECT_INSIGHTS.md) - Design philosophy and collaboration model

### Get Help

- Check the main [README.md](../../README.md) for additional documentation
- Check tests for usage patterns: `tests/`
