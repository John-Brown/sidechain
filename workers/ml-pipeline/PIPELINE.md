# ML Pipeline — Stage Reference & Improvement Guide

> Last updated: 2026-09-24

## Architecture Overview

8-stage DAG (incl. `waveform` root stage) running on [Modal](https://modal.com) serverless. Each stage is a `@modal.fastapi_endpoint` accepting `StageRequest` and returning `StageResponse`. Stages download inputs from S3, process, upload results as JSON to S3, and optionally POST a callback.

```
                ┌──────────┐
        ┌───────┤  video    ├───────┐
        │       └──────────┘       │
        v            v             v
   ┌────────┐  ┌──────────────┐  ┌──────────────────┐
   │  VAD   │  │ Transcription│  │ Facial Tracking   │
   └───┬────┘  └──────┬───────┘  └────────┬──────────┘
       │              │                   │
       │              │            ┌──────┴──────┐
       │              │            │ Mouth Energy│
       │              │            └──────┬──────┘
       │              │                   │
       ├──────────────┼───────────────────┤
       v              v                   v
   ┌──────────────────────────────────────────┐
   │          Diarization (IN DEV)            │
   └────────────────┬─────────────────────────┘
                    v
   ┌──────────────────────────────────────────┐
   │       State Annotation (IN DEV)          │
   └────────────────┬─────────────────────────┘
                    v
   ┌──────────────────────────────────────────┐
   │    Intent Classification (IN DEV)        │
   └──────────────────────────────────────────┘
```

Root stages (VAD, Transcription, Facial Tracking) fire in parallel after upload. Downstream stages cascade via `triggerReadyStages()` on callback.

---

## Shared Utilities (`stages/utils.py`)

| Function | Purpose |
|----------|---------|
| `get_s3_client()` | boto3 client from `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, region from `AWS_DEFAULT_REGION` or `S3_REGION` |
| `get_bucket()` | Returns `S3_BUCKET` env var |
| `download_from_s3(key, path)` | Downloads file to local path |
| `upload_to_s3(path, key)` | Uploads with `application/json` content type |
| `download_json_from_s3(key)` | Download + JSON parse |
| `upload_json_to_s3(data, key)` | JSON serialize + upload |
| `load_audio(path)` | ffmpeg → 16kHz mono PCM → `torch.Tensor` via soundfile |

**Audio loading**: Uses subprocess ffmpeg + soundfile to avoid torchcodec dependency (torchaudio 2.9+ requires it for all formats, and it's not available in Modal images).

---

## Stage 1: Voice Activity Detection (VAD)

### Current Implementation

| | |
|---|---|
| **Library** | [Silero VAD v5](https://github.com/snakers4/silero-vad) via `torch.hub` |
| **Model** | `snakers4/silero-vad` (ONNX/PyTorch, ~2MB) |
| **GPU** | None (CPU only) |
| **Modal image** | `vad_image` — torch, ffmpeg, soundfile |
| **Timeout** | 600s |
| **Memory** | 2048 MB |

### How It Works

1. Downloads video from S3, extracts audio via `load_audio()` (ffmpeg → 16kHz mono)
2. Loads Silero VAD v5 from torch hub
3. Slides 512-sample windows (32ms at 16kHz) over waveform, gets per-window speech probability
4. Merges adjacent speech windows within 300ms gap → `VadSegment[]` with averaged confidence
5. Resamples to 100ms frames (10Hz) → `VadFrame[]` with `speech_probability`
6. Uploads JSON with `segments` + `frames` + `metadata`

### Parameters

| Param | Value | Notes |
|-------|-------|-------|
| `SAMPLE_RATE` | 16000 | Standard for speech models |
| `WINDOW_SIZE_SAMPLES` | 512 | 32ms — Silero v5 requires exactly this |
| `MERGE_GAP_MS` | 300 | Segments within 300ms merge into one |
| `VAD_THRESHOLD` | 0.5 | Probability cutoff for speech detection |

### Output Schema

```
S3 key: results/{videoId}/voice_activity.json
```

```jsonc
{
  "metadata": {
    "source_file": "string",
    "format_version": "1.0",
    "created_timestamp": "ISO8601",
    "total_secs": 0.0,
    "algorithm": {
      "name": "silero-vad",
      "model": "silero-vad-v5",
      "version": "v5",
      "processing_time": 0.0,
      "window_size_ms": 100,
      "hop_size_ms": 100,
      "sample_rate": 16000,
      "threshold": 0.5,
      "parameters": { "merge_gap_ms": 300 }
    },
    "total_segments": 0,
    "speech_ratio": 0.0
  },
  "segments": [
    { "time_range": { "start": 0.0, "end": 0.0 }, "confidence": 0.0 }
  ],
  "frames": [
    { "time_range": { "start": 0.0, "end": 0.0 }, "speech_probability": 0.0 }
  ]
}
```

**NOTE**: VAD uses `segments` + `frames` at the top level, NOT `data`. This is the only stage that diverges from the `{ metadata, data }` pattern.

### Alternatives & Improvements

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Silero VAD v5** (current) | Enterprise-grade accuracy, ~2MB model, CPU-only, fast cold starts | No v6 yet | **Keep** — still best-in-class for this use case |
| **WebRTC VAD** | Extremely fast, zero deps, pure CPU | Rule-based, weaker in noise | Not worth the accuracy tradeoff |
| **pyannote VAD** | State-of-the-art, deep learning | Heavier (PyTorch), slower cold start, overkill as standalone VAD | Already using pyannote for diarization — its internal VAD handles this |
| **FSMN-VAD** (Alibaba) | Efficient DNN, good endpoint detection | Chinese-focused, less community support | Worth watching, not mature enough |

**Recommendation**: No change needed. Silero VAD v5 is the right tool here.

---

## Stage 2: Speech Transcription

### Current Implementation

| | |
|---|---|
| **Library** | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2) |
| **Model** | `large-v3-turbo` (float16) — upgraded from large-v3 for ~6x speed, half memory |
| **GPU** | A10G |
| **Modal image** | `transcription_image` — torch, faster-whisper, ctranslate2, ffmpeg |
| **Timeout** | 1200s |
| **Memory** | 4096 MB |

### How It Works

1. Downloads video from S3
2. Loads `WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")`
3. Transcribes with `beam_size=5`, `word_timestamps=True`, `vad_filter=False`, then WhisperX wav2vec2 forced alignment (+ optional `whisperx.assign_word_speakers` via pyannote when `HF_TOKEN` is set)
4. Collects word-level results: `{ time_range, speech: { word, speaker, confidence, speech_segment } }`
5. Uploads JSON

### Parameters

| Param | Value | Notes |
|-------|-------|-------|
| `beam_size` | 5 | Standard quality setting |
| `word_timestamps` | True | Required for annotation alignment |
| `vad_filter` | False | Disabled; the wav2vec2 alignment pass refines word timing |

### Output Schema

```
S3 key: results/{videoId}/speech_transcription.json
```

```jsonc
{
  "metadata": {
    "source_file": "string",
    "format_version": "1.0",
    "created_timestamp": "ISO8601",
    "total_secs": 0.0,
    "algorithm": {
      "name": "whisperx",
      "model": "large-v3-turbo",
      "version": "faster-whisper+wav2vec2",
      "processing_time": 0.0,
      "parameters": {
        "beam_size": 5,
        "vad_filter": false,
        "word_timestamps": true,
        "language_detected": "en",
        "language_probability": 0.0
      }
    }
  },
  "data": [
    {
      "time_range": { "start": 0.0, "end": 0.0 },
      "speech": {
        "word": "string",
        "speaker": "unknown",
        "confidence": 0.0,
        "speech_segment": 0
      }
    }
  ]
}
```

### Alternatives & Improvements

| Option | Speed vs large-v3 | Accuracy (WER) | GPU Memory | Word Timestamps | Notes |
|--------|--------------------|----------------|------------|-----------------|-------|
| **large-v3** | 1x baseline | ~6-7% | ~8-10 GB | Yes | Good multilingual |
| **large-v3-turbo** | **~6x faster** | ~5.8% (comparable) | **~4-6 GB** | Yes | **Drop-in upgrade via faster-whisper** |
| **distil-large-v3** | **~6x faster** | ~6-8% | **~4-6 GB** | Yes (forced alignment) | English-optimized |
| **BatchedInferencePipeline** | **4-8x faster** | Same as base model | Same | Yes (disable for max speed) | Batches chunks in parallel |
| **WhisperX** | Similar to base | Matches Whisper | ~9-11 GB | **Enhanced** (wav2vec2 alignment) | Best word-level alignment + built-in diarization |
| **insanely-fast-whisper** | **~10x faster** | Same | ~3-5 GB | Yes | Less tested stability on serverless |

**Recommended upgrades** (in priority order):

1. ✅ **Done: switched to `large-v3-turbo`** — Drop-in change, ~6x faster, half the memory, near-identical accuracy:
   ```python
   # Change one line:
   model = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")
   ```

2. **Add BatchedInferencePipeline** — Another 4-8x on top, especially for longer files:
   ```python
   from faster_whisper import WhisperModel, BatchedInferencePipeline
   model = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")
   batched = BatchedInferencePipeline(model)
   segments, info = batched.transcribe("audio.mp3", batch_size=16, word_timestamps=True)
   ```

3. ✅ **Done: WhisperX alignment integrated** (transcription.py). Original rationale: Provides wav2vec2-aligned word timestamps (more precise than Whisper's native) and built-in speaker diarization. Would let you skip the separate diarization stage entirely for some use cases.

**GPU downgrade opportunity**: With turbo model, could potentially drop from A10G to T4, reducing cost.

---

## Stage 3: Facial Tracking

### Current Implementation

| | |
|---|---|
| **Library** | [MediaPipe FaceLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) (task API) |
| **Model** | `face_landmarker_v2` (~4MB task bundle) |
| **GPU** | T4 (Depth Anything V2 keyframe depth for the mesh overlay) |
| **Modal image** | `cpu_heavy_image` — mediapipe, opencv-python-headless |
| **Timeout** | 1800s (30 min) |
| **Memory** | 4096 MB |

### How It Works

1. Downloads video from S3
2. Downloads FaceLandmarker model bundle from Google if not cached
3. Opens video with OpenCV, iterates every frame
4. Per frame extracts:
   - **478 landmarks** (pixel coordinates)
   - **52 ARKit blend shapes** (canonical order)
   - **Head pose** (rotation [pitch, yaw, roll] + translation [x, y, z]) from 4x4 transformation matrix
   - **Gaze direction** [x, y, z] from iris landmarks (L468-472, R473-477), fallback to nose if matrix unavailable
   - **Face detected** boolean + confidence
5. Uploads JSON with `data: FacialTrackingFrame[]`

### Key Constants

- `BLEND_SHAPE_NAMES`: 52 ARKit blend shapes in canonical order (index 0-51)
- Model downloaded from `storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`

### Output Schema

```
S3 key: results/{videoId}/facial_tracking.json
```

```jsonc
{
  "metadata": {
    "source_file": "string",
    "format_version": "1.0",
    "created_timestamp": "ISO8601",
    "total_secs": 0.0,
    "algorithm": {
      "name": "mediapipe-face-landmarker",
      "model": "face_landmarker_v2",
      "version": "0.10",
      "processing_time": 0.0,
      "parameters": {
        "num_faces": 1,
        "min_detection_confidence": 0.5,
        "min_tracking_confidence": 0.5,
        "output_face_blendshapes": true
      }
    },
    "video_width": 0,
    "video_height": 0
  },
  "data": [
    {
      "time": 0.0,  // single float, NOT time_range
      "facial_tracking": {
        "tracking": {
          "blendshapes": [0.0],       // float[52]
          "head_pose": {
            "rotation": [0.0, 0.0, 0.0],     // [pitch, yaw, roll] radians
            "translation": [0.0, 0.0, 0.0]    // [x, y, z]
          },
          "gaze_direction": [0.0, 0.0, 0.0],  // [x, y, z] unit vector
          "landmarks": [[0.0, 0.0]],           // [x, y][478]
          "confidence": 0.0,
          "face_detected": true
        }
      }
    }
  ]
}
```

**NOTE**: Uses `time` (single float), NOT `time_range`. This is the only stage with a scalar timestamp.

### Alternatives & Improvements

| Option | Landmarks | Blend Shapes | Head Pose | GPU Accel | Notes |
|--------|-----------|-------------|-----------|-----------|-------|
| **MediaPipe FaceLandmarker** (current) | 478 | 52 ARKit | 6DoF | TFLite delegate | Best all-in-one, production-grade |
| **DLIB** | 68 | No | Basic | CPU only | Too few landmarks, no blend shapes |
| **InsightFace** | ~500 | Partial (custom) | Yes | ONNX/PyTorch | Good detection, but blend shape extraction requires custom work |
| **face-alignment** | 68-468 | No | 3D | Limited | Good pose, too few landmarks |
| **EMOCA/DECA** (FLAME 3DMM) | 500+ | 52 ARKit-compatible | Full 3D | PyTorch CUDA | Better accuracy for blend shapes + pose via 3D morphable model fitting |

**Potential improvements**:

1. **Enable TFLite GPU delegate** — MediaPipe supports GPU acceleration. Could switch from 4-CPU to GPU container, significantly faster for long videos. Requires testing on Modal's GPU hardware.

2. **Frame subsampling** — Currently processes every frame. For 30fps video, could subsample to 15fps or 10fps and interpolate, cutting processing time in half with minimal quality loss for annotation purposes.

3. **EMOCA/DECA for higher-fidelity blend shapes** — These parametric 3D morphable models produce more physically accurate blend shape values. Worth investigating if annotation quality is limited by MediaPipe blend shape noise. Tradeoff: much heavier dependency (PyTorch + FLAME model), 10-20 FPS on GPU.

**Recommendation**: Keep MediaPipe for now. Frame subsampling is the highest-ROI improvement.

---

## Stage 4: Mouth Energy

### Current Implementation

| | |
|---|---|
| **Library** | Custom (numpy only) |
| **Input** | Facial tracking JSON (blend shapes) |
| **GPU** | None |
| **Modal image** | `cpu_light_image` — numpy only |
| **Timeout** | 300s |
| **Memory** | 1024 MB |

### How It Works

1. Downloads facial tracking JSON from S3
2. Groups frames into 100ms windows (10Hz output)
3. Per window: averages blend shape values, computes weighted sum of mouth-related blend shapes
4. Handles missing face detection (zero energy)
5. Uploads JSON

### Blend Shape Weights

| Blend Shape | Index | Weight |
|-------------|-------|--------|
| jawOpen | 24 | 0.25 |
| mouthSmileLeft | 43 | 0.10 |
| mouthSmileRight | 44 | 0.10 |
| mouthFunnel | 33 | 0.10 |
| mouthPucker | 40 | 0.10 |
| mouthOpen | 36 | 0.15 |
| mouthShrugUpper | 42 | 0.05 |
| mouthShrugLower | 41 | 0.05 |
| mouthLeft | 35 | 0.05 |
| mouthRight | 39 | 0.05 |

### Output Schema

```
S3 key: results/{videoId}/mouth_energy.json
```

```jsonc
{
  "metadata": { /* standard AnnotationMetadata */ },
  "data": [
    {
      "time_range": { "start": 0.0, "end": 0.1 },
      "mouth_energy": {
        "blend_shape_energy": {
          "jawOpen": { "raw_value": 0.0, "deviation": 0.0 }
          // ... per blend shape
        },
        "mouth_energy": 0.0  // weighted sum [0, 1]
      }
    }
  ]
}
```

### Potential Improvements

- **No library alternatives** — this is custom domain logic, well-suited to the task.
- Could add **derivative/velocity** of mouth energy for detecting onset/offset of speech gestures.
- Could add **spectral features** from audio alongside visual mouth energy for multimodal speech detection.

---

## Stage 5: Speaker Diarization

### Current Implementation

| | |
|---|---|
| **Library** | [pyannote.audio](https://github.com/pyannote/pyannote-audio) (pyannote/speaker-diarization-3.1 pipeline) |
| **Model** | `pyannote/speaker-diarization-3.1` (HuggingFace) |
| **GPU** | A10G |
| **Modal image** | `diarization_image` — pyannote.audio, speechbrain, torch, ffmpeg |
| **Timeout** | 1200s |
| **Memory** | 4096 MB |
| **Status** | Fixed — auth updated to `token=`, GPU `.to()` added |

### How It Works

1. Downloads video + VAD data + mouth energy data from S3
2. Loads pyannote pipeline from HuggingFace
3. Runs diarization → `(turn, _, speaker)` tuples
4. Converts to segment format, sorts by time
5. Enriches with:
   - Per-speaker timing metadata (duration, turn count, avg turn length)
   - Visible speaker probability (correlates mouth energy with speaker turns)
6. Uploads JSON

### Output Schema

```
S3 key: results/{videoId}/diarization.json
```

```jsonc
{
  "metadata": {
    /* standard fields */
    "algorithm": {
      "name": "pyannote-diarization",
      "model": "speaker-diarization-3.1",
      "version": "3.1",
      "processing_time": 0.0
    },
    "requested_speakers": null,
    "detected_speakers": 0,
    "visible_speaker_probability": { "Speaker 1": 0.0 },
    "visible_speaker_detection_status": "estimated",
    "audio_channel_speaker_probability": {},
    "audio_channel_detection_status": "not_applicable",
    "speaker_timing_metadata": {
      "Speaker 1": {
        "total_duration_secs": 0.0,
        "turn_count": 0,
        "avg_turn_duration_secs": 0.0
      }
    }
  },
  "data": [
    {
      "time_range": { "start": 0.0, "end": 0.0 },
      "diarization": { "speaker": "Speaker 1" }
    }
  ]
}
```

### Authentication

Uses `token=` parameter (not the deprecated `use_auth_token=`). Requires a HuggingFace token that has accepted the pyannote model license at https://huggingface.co/pyannote/speaker-diarization-3.1.

### Alternatives & Improvements

| Option | Accuracy (DER) | Speed | GPU | Notes |
|--------|----------------|-------|-----|-------|
| **pyannote 3.1** (current) | State-of-the-art | RTF 0.1-0.5 on GPU | Recommended | Best overall, fix auth and ship |
| **NeMo MSDD** (NVIDIA) | Competitive | Very fast (end-to-end) | Required (A100/H100 optimal) | End-to-end neural, fewer hyperparams. Heavier VRAM. |
| **SpeechBrain** | Good (1-2% higher DER in noise) | Moderate | Optional | Lightweight, easy customization |
| **WhisperX** (integrated) | Good | Fast | Yes | Built-in diarization alongside transcription — could replace separate stage |
| **DiariZen** | Competitive | Moderate | Yes | Newer toolkit built on pyannote + AudioZen, structured pruning for efficiency |

**Recommended upgrades**:

1. ~~Fix auth (`use_auth_token` → `token`)~~ — **Done**
2. ~~Add GPU warmup (`pipeline.to(torch.device("cuda"))`)~~ — **Done**
3. **Consider WhisperX** — for Phase 4+, WhisperX provides transcription + diarization in one pass, which would eliminate this stage entirely and provide speaker-attributed words directly

---

## Stage 6: State Annotation

### Current Implementation

| | |
|---|---|
| **Library** | Custom (rule-based) |
| **Input** | Diarization JSON |
| **GPU** | None |
| **Modal image** | `cpu_light_image` — numpy only |
| **Timeout** | 300s |
| **Memory** | 1024 MB |
| **Status** | **Gated** — depends on diarization |

### Rules

| Condition | Output Category |
|-----------|----------------|
| Speaker is speaking (diarization segment) | `expression.state.speaking` |
| Gap between segments > 0.01s | `expression.state.listening` |
| No speakers detected | Entire timeline = `expression.state.listening` |

### Output Schema

```
S3 key: results/{videoId}/state_annotation.json
```

```jsonc
{
  "metadata": { /* standard fields */ },
  "data": [
    {
      "time_range": { "start": 0.0, "end": 0.0 },
      "category": "expression.state.speaking",
      "note": "string",
      "parameters": { "speaker": "Speaker 1" }
    }
  ]
}
```

States are **contiguous** — they partition the full timeline with no gaps.

### Potential Improvements

- Currently binary (speaking/listening). Could add **thinking** (silence after being addressed), **interrupted** (speaker overlap), **backchanneling** (short vocalizations during another's turn).
- Could incorporate **head nod detection** from facial tracking to identify active listening vs. passive.

---

## Stage 7: Intent Classification

### Current Implementation

| | |
|---|---|
| **Library** | [Anthropic Python SDK](https://github.com/anthropics/anthropic-sdk-python) (>=1.0) |
| **Model** | `claude-sonnet-5` |
| **GPU** | None |
| **Modal image** | `intent_image` — anthropic SDK only |
| **Timeout** | 900s |
| **Memory** | 1024 MB |
| **Status** | **Gated** — depends on state annotation |

### How It Works

1. Downloads state annotations, transcription, and VAD from S3
2. Filters for speaking segments only
3. Per speaking segment:
   - Extracts transcript words within the segment's time range
   - Collects preceding context (up to 30 words)
   - Calls Claude with a structured prompt
   - Parses JSON response: `{ intent, intensity, valence, confidence, reasoning }`
   - Validates + clamps values; fallback to defaults on parse failure

### Classification Taxonomy

| Dimension | Values |
|-----------|--------|
| **Intent** | engage, inform, inquire, challenge, comfort, celebrate |
| **Intensity** | low, moderate, high |
| **Valence** | positive, neutral, negative |

### Output Schema

```
S3 key: results/{videoId}/intent_classification.json
```

```jsonc
{
  "metadata": {
    /* standard fields */
    "algorithm": {
      "name": "claude-intent-classification",
      "model": "claude-sonnet-5",
      "version": "1.0",
      "processing_time": 0.0,
      "parameters": {
        "classified_segments": 0,
        "skipped_segments": 0
      }
    }
  },
  "data": [
    {
      "time_range": { "start": 0.0, "end": 0.0 },
      "intent_classification": {
        "intent": "inform",
        "intensity": "moderate",
        "valence": "neutral",
        "confidence": 0.85,
        "reasoning": "string"
      }
    }
  ]
}
```

### Potential Improvements

| Improvement | Impact | Effort |
|-------------|--------|--------|
| **Update model** to a newer Claude model | Better classification quality | Trivial (change string) |
| **Batch segments** into fewer API calls | Reduce latency + cost (currently 1 call per segment) | Medium — restructure prompt for multi-segment classification |
| **Add audio features** to prompt context | Better intent detection (tone, prosody) | Medium — would need to extract audio features or use multimodal |
| **Structured outputs** (tool_use) | More reliable JSON parsing, eliminate regex fallback | Low-medium — use Anthropic tool_use instead of free-form JSON |
| **Caching** | Skip re-classification for identical text | Low |

---

## Modal Architecture

### Current Pattern: Function-based endpoints

Each stage is a standalone `@app.function` + `@modal.fastapi_endpoint`. This works but means:
- Model loading happens on every cold start (no `@modal.enter()` lifecycle)
- No container reuse between requests for stateful models (Whisper, pyannote)

### Recommended: Class-based with `@modal.enter()`

Modal's class pattern loads models once on container startup, amortizing cold start across requests:

```python
@app.cls(
    image=transcription_image,
    secrets=[modal.Secret.from_name("aws-credentials")],
    gpu="A10G",
    timeout=1200,
    memory=4096,
    scaledown_window=300,  # keep warm 5 min after last request
)
class TranscriptionService:
    @modal.enter()
    def load_model(self):
        from faster_whisper import WhisperModel
        self.model = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")

    @modal.fastapi_endpoint(method="POST")
    def process(self, request: StageRequest) -> StageResponse:
        # self.model already loaded
        ...
```

**Benefits**:
- Model loaded once, reused across requests
- `scaledown_window` keeps containers warm, avoiding cold starts for bursty workloads
- `@modal.concurrent(max_inputs=N)` for stages that can handle concurrent requests (VAD, mouth energy)

### Other Modal Improvements

| Feature | Current | Recommended |
|---------|---------|-------------|
| **Container lifecycle** | Function-based (no model caching) | Class-based with `@modal.enter()` |
| **Autoscaling** | Default | `scaledown_window=300` for GPU stages |
| **Python version** | 3.11 | 3.11 is fine (3.12+ also supported) |
| **Image layering** | Separate image per stage | Good — keeps images minimal |

---

## Environment Variables

| Variable | Secret Name | Used By |
|----------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | `aws-credentials` | All stages (S3) |
| `AWS_SECRET_ACCESS_KEY` | `aws-credentials` | All stages (S3) |
| `AWS_DEFAULT_REGION` | `aws-credentials` | S3 client region |
| `S3_BUCKET` | `aws-credentials` | S3 bucket name |
| `HF_TOKEN` | `huggingface` | Diarization (pyannote model access) |
| `ANTHROPIC_API_KEY` | `anthropic` | Intent classification |

---

## Priority Improvements Summary

### Quick Wins (minimal code changes)

| # | Change | Stage | Impact |
|---|--------|-------|--------|
| ~~1~~ | ~~`use_auth_token` → `token`~~ | Diarization | **Done** |
| ~~2~~ | ~~`large-v3` → `large-v3-turbo`~~ | Transcription | **Done** |
| ~~3~~ | ~~Add `pipeline.to(torch.device("cuda"))`~~ | Diarization | **Done** |
| 4 | Claude model string | Intent | Already latest (`claude-sonnet-5`) |

### Medium-Term (architectural)

| # | Change | Impact |
|---|--------|--------|
| 5 | Refactor to class-based Modal pattern (`@modal.enter()`) | Eliminates model reload on every request |
| 6 | Add `BatchedInferencePipeline` for transcription | Additional 4-8x speedup |
| 7 | Frame subsampling for facial tracking (30fps → 10-15fps) | ~2-3x faster processing |
| 8 | Use Anthropic tool_use for intent classification | Reliable structured output |

### Longer-Term (library migrations)

| # | Change | Impact |
|---|--------|--------|
| 9 | Evaluate WhisperX for combined transcription + diarization | Eliminates separate diarization stage, better word alignment |
| 10 | Evaluate EMOCA/DECA for higher-fidelity facial tracking | Better blend shape accuracy for annotation quality |
| 11 | Batch intent classification (multi-segment per API call) | Reduce API cost + latency |

---

## Common Output Contract

All stages (except VAD) follow this pattern:

```jsonc
{
  "metadata": {
    "source_file": "string",       // S3 key of source
    "format_version": "1.0",
    "created_timestamp": "ISO8601",
    "total_secs": 0.0,             // video duration
    "algorithm": {
      "name": "string",
      "model": "string",
      "version": "string",
      "processing_time": 0.0,      // seconds
      "parameters": {}             // stage-specific
    }
  },
  "data": [/* stage-specific items */]
}
```

**VAD exception**: Uses `segments` + `frames` instead of `data`.

All times in **seconds** (float). Time ranges are half-open `[start, end)`.
