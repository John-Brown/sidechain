# Algorithm Reference, Part D: Phase 0 Extras (Per-Speaker Transcription, Analyst Report)

> **Status (2026-09-24):** The algorithm descriptions here (processing steps, parameters, blend-shape weights, state rules, intent taxonomy and prompt) are still the design reference for each stage. The implementation details are from the Phase 0 spike and are historical: `src/processing/...` paths, FaceKitRunner (ARKit, 51 blend shapes), OpenAI/MLX Whisper, Silero VAD v3.1, local CLI usage and output directories. The current implementations are the Modal stages in `workers/ml-pipeline/stages/*.py` (Silero VAD v5, faster-whisper large-v3, MediaPipe FaceLandmarker with 52 blend shapes), documented in [PIPELINE.md](../workers/ml-pipeline/PIPELINE.md); current result shapes live in `packages/shared/src/annotation-types.ts`.

> Neither feature in this part exists in the current monorepo. There is no stereo per-speaker transcription stage and no analyst report generator in `workers/ml-pipeline/` or `apps/web/`. These sections are kept as algorithm background only.

**Parts:** [02a: VAD, transcription, facial tracking](02a-algorithm-reference-vad-transcription-face.md) · [02b: mouth energy, diarization, states](02b-algorithm-reference-mouth-diarization-states.md) · [02c: intents, dependency graph, performance](02c-algorithm-reference-intents-summary.md) · [02d: Phase 0 extras](02d-algorithm-reference-phase0-extras.md)

---

## 8. Per-Speaker Transcription

### Purpose
Transcribe stereo recordings with dedicated microphones per speaker, producing per-speaker word-level transcription with accurate speaker attribution.

### Algorithm
**Stereo Source Separation + MLX Whisper** - Multi-stage pipeline combining audio separation, adaptive gating, and Apple Silicon-optimized transcription.

### Implementation
**Directory**: `src/processing/pre_processing/per_speaker_transcription/` (Phase 0 only; no current equivalent)

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

10. **Output in Sidechain Format**
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
**Directory**: `src/analyst_report/` (Phase 0 only; no current equivalent)

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

Analyst report format doc was not migrated from the Phase 0 spike.

---

## Next Steps

- Current pipeline internals: [PIPELINE.md](../workers/ml-pipeline/PIPELINE.md)
- End-to-end flow, gates and data streams: [system-flow.md](system-flow.md)
- Developer setup: [getting-started.md](getting-started.md)
- Phase 0 data flow and quick start (archived): [03-data-flow.md](../plans/archive/phase-0-reference/03-data-flow.md), [04-quick-start.md](../plans/archive/phase-0-reference/04-quick-start.md)

Previous: [Part C](02c-algorithm-reference-intents-summary.md)
