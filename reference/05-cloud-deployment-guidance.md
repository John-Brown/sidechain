# Cloud Deployment & Language Migration Guidance

High-level architectural guidance for deploying the Sidechain processing pipeline to cloud infrastructure and evaluating language migration options.

## Table of Contents

1. [Current Platform Coupling](#current-platform-coupling)
2. [What's Already Portable](#whats-already-portable)
3. [Cloud Deployment Strategy](#cloud-deployment-strategy)
4. [Language Migration Analysis](#language-migration-analysis)
5. [Recommended Architecture](#recommended-architecture)
6. [Migration Phases](#migration-phases)
7. [Open Questions](#open-questions)

---

## Current Platform Coupling

### Portable (no changes needed)

| Component | Stack | Notes |
|-----------|-------|-------|
| VAD (Silero) | PyTorch | CPU-only, runs anywhere |
| Speech Transcription (Whisper) | PyTorch | CUDA fallback works on Linux |
| Speaker Diarization (pyannote) | PyTorch | MPS → CUDA → CPU auto-fallback |
| Mouth Energy | NumPy/SciPy | Pure computation on facial data |
| State Annotation | Pure Python | Rule-based, no dependencies |
| JSON utilities | Pure Python | Platform check only for machine ID |

### macOS-Locked

| Component | Dependency | Severity | Workaround |
|-----------|-----------|----------|------------|
| Facial Tracking | FaceKitRunner (ARKit binary) | Hard | Replace with MediaPipe/OpenFace |
| Per-Speaker Transcription | MLX Whisper (Apple Silicon) | Medium | Swap to `faster-whisper` or standard Whisper (subprocess call, easy) |
| Intent Classification | Anthropic SDK (direct API) | Medium | Refactor to use OpenAI/Anthropic SDKs directly |
| Sidechain App | SwiftUI | Hard | Web UI replacement needed |

### Key Insight

FaceKitRunner is the only true hard blocker. Everything else either already has fallbacks or is a subprocess call that can be swapped. The processing pipeline was designed modularly enough that individual algorithms can be replaced without touching the rest.

---

## What's Already Portable

About **70-80% of the pipeline runs on Linux today** if you:

1. Skip facial tracking (`--no-raw-facial-tracking --no-raw-mouth-energy`)
2. Use standard Whisper instead of MLX Whisper (already the default for non-stereo)
3. Use direct Anthropic/OpenAI API calls for intent classification

This means a "cloud-lite" deployment is achievable without any code changes — just flag configuration. The question is whether you need the remaining 20-30%.

---

## Cloud Deployment Strategy

### Option A: Containerized Python Pipeline (Lowest Effort)

Dockerize the existing Python pipeline as-is, skipping macOS-only components.

```
┌─────────────────────────────────────────────────┐
│  Docker Container (Linux + CUDA)                │
│                                                  │
│  processor.py                                    │
│  ├── VAD (Silero)               ✅              │
│  ├── Transcription (Whisper)    ✅              │
│  ├── Diarization (pyannote)     ✅ (CUDA)      │
│  ├── Facial Tracking            ❌ (skip)       │
│  ├── Mouth Energy               ❌ (skip)       │
│  ├── State Annotation           ✅              │
│  └── Intent Classification      ✅ (direct API) │
└─────────────────────────────────────────────────┘
```

**Pros**: Minimal code changes. Reuses existing processor.py. Ship in weeks.
**Cons**: No facial tracking. Still Python. Cold start is slow (model loading).

**Infrastructure**: GPU instance (A10G/T4 for diarization), S3/GCS for video storage, job queue (SQS/Pub-Sub) for work distribution.

### Option B: Hybrid (macOS Workers + Cloud Orchestration)

Keep macOS machines for FaceKitRunner, run everything else in cloud.

```
┌──────────────────┐     ┌──────────────────────────┐
│  Cloud (Linux)   │     │  macOS Worker (on-prem)  │
│                  │     │                          │
│  Orchestrator    │────→│  FaceKitRunner           │
│  VAD             │     │  MLX Whisper             │
│  Whisper         │     │  Mouth Energy            │
│  Diarization     │     │                          │
│  State/Intent    │←────│  Returns JSON results    │
│                  │     │                          │
└──────────────────┘     └──────────────────────────┘
```

**Pros**: Full feature parity. FaceKitRunner keeps working.
**Cons**: Operational complexity. Requires maintaining macOS fleet.

### Option C: Full Cloud (Replace FaceKitRunner)

Replace FaceKitRunner with MediaPipe Face Mesh. This is more viable than it appears — MediaPipe deliberately outputs ARKit-compatible blend shape names. The 10 mouth blend shapes used for mouth energy (the only ones that affect the automated pipeline) map directly. No weight recalibration needed.

See [Facial Tracking Reference](06-facial-tracking-reference.md) for the complete analysis of what FaceKitRunner extracts, what's consumed downstream, and the detailed replacement strategy.

**Key insight**: For stereo recordings with per-speaker mics, audio channel detection provides speaker identity without any video analysis. Facial tracking becomes purely a visualization enhancement — meaning FaceKitRunner replacement may not be needed at all.

---

## Language Migration Analysis

### Why Consider Migration?

Potential drivers:
- Cloud deployment ergonomics (containerization, serverless)
- Web-based annotation UI to replace SwiftUI
- Team familiarity / hiring pool
- Unified stack for API + UI + processing

### Language Options

#### TypeScript/Node.js

**Good for**: API layer, orchestration, web UI
**Bad for**: ML inference, numerical computation

The ML models (Whisper, pyannote, Silero-VAD) are Python/PyTorch ecosystems. There's no TypeScript equivalent. You'd end up with:
- TypeScript API/orchestration layer calling Python ML workers
- Or calling cloud ML APIs (Whisper API, AssemblyAI, etc.) instead of local inference

**Verdict**: Makes sense for the orchestration layer and web UI. Not a replacement for the inference code.

#### Rust

**Good for**: Performance-critical processing, CLI tooling, WASM for web
**Bad for**: ML model inference (ecosystem is immature), rapid prototyping

PyTorch has C++ bindings (`libtorch`) that Rust can call via FFI, but the ergonomics are poor and the ecosystem is thin. You'd spend more time fighting bindings than building features.

**Verdict**: Overkill for this use case unless processing speed becomes a bottleneck (it isn't — the bottleneck is model inference, not orchestration).

#### Go

**Good for**: API servers, containerized services, CLI tools
**Bad for**: ML inference (same ecosystem gap as Rust)

**Verdict**: Same story as Rust. Good server language, but the ML code stays Python.

#### Python (Keep It)

**Good for**: Everything the pipeline currently does
**Bad for**: Web UI (use TypeScript for that)

The Python ML ecosystem is unmatched. PyTorch, HuggingFace, Whisper, pyannote — all Python-first. Rewriting inference code in another language means maintaining custom bindings to the same underlying C++/CUDA kernels.

**Verdict**: Keep Python for ML processing. It's the right tool.

### Realistic Migration Path

The pragmatic answer is **not** "rewrite in TypeScript" but rather **"add TypeScript where it's the right tool"**:

```
                    ┌─────────────────────────────┐
                    │  TypeScript                  │
                    │  ├── Web UI (React/Next.js)  │
                    │  ├── API Gateway             │
                    │  ├── Job Orchestration        │
                    │  └── Real-time WebSocket      │
                    └──────────┬──────────────────┘
                               │ HTTP / gRPC / Queue
                    ┌──────────▼──────────────────┐
                    │  Python Workers              │
                    │  ├── VAD                      │
                    │  ├── Transcription            │
                    │  ├── Diarization              │
                    │  ├── Facial Tracking          │
                    │  ├── State Annotation         │
                    │  └── Intent Classification    │
                    └─────────────────────────────┘
```

You're not moving away from Python — you're putting a cloud-native layer around it.

---

## Recommended Architecture

### Cloud-Native Sidechain

```
┌────────────────────────────────────────────────────────────┐
│                        CDN / Edge                          │
└────────────────────────┬───────────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────────┐
│  API Gateway (TypeScript)                                  │
│  ├── Auth / Session management                             │
│  ├── Upload handling (presigned URLs → object storage)     │
│  ├── Job submission → queue                                │
│  ├── WebSocket for progress updates                        │
│  └── REST API for annotation CRUD                          │
└────────────────────────┬───────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
┌────────▼─────┐  ┌──────▼──────┐  ┌─────▼──────┐
│  Web UI      │  │  Job Queue  │  │  Object    │
│  (React)     │  │  (SQS/etc)  │  │  Storage   │
│              │  │             │  │  (S3/GCS)  │
│  Timeline    │  └──────┬──────┘  └─────┬──────┘
│  Video       │         │               │
│  Annotation  │  ┌──────▼──────┐        │
│  Task Mode   │  │  Python     │        │
│              │  │  Workers    │←───────┘
└──────────────┘  │  (GPU pods) │
                  │             │
                  │  processor  │
                  │  .py        │
                  └─────────────┘
```

### Key Design Decisions

**Video Storage**: Object storage (S3/GCS), not local filesystem. Workers download on demand.

**Job Queue**: One video = one job. Workers pull from queue, process, write results back to object storage. Dead letter queue for failures.

**GPU Allocation**: Diarization is the only stage that strongly benefits from GPU. Could run VAD/transcription on CPU-only instances and reserve GPU for diarization. Or use cloud transcription APIs (Whisper API, AssemblyAI) to avoid GPU entirely for transcription.

**Annotation Storage**: JSON files in object storage work fine. Or migrate to a database if you need query capabilities across sessions.

**Web UI**: The SwiftUI Sidechain app is excellent for desktop use but doesn't scale to cloud. A web-based annotation UI (React + canvas-based timeline) would be needed. This is a significant effort — the timeline rendering, speech block editing, and task mode logic are complex.

### Cloud Transcription APIs as Alternative

Instead of running Whisper locally, consider:

| Service | Cost | Quality | Diarization | Word Timestamps |
|---------|------|---------|-------------|-----------------|
| OpenAI Whisper API | $0.006/min | Excellent | No | Yes |
| AssemblyAI | $0.01/min | Excellent | Yes (built-in) | Yes |
| Deepgram | $0.005/min | Good | Yes | Yes |
| Google Speech-to-Text | $0.006/min | Good | Yes | Yes |

AssemblyAI or Deepgram could replace both Whisper AND pyannote diarization in a single API call, eliminating the GPU requirement entirely for audio processing. Trade-off: cost per minute, vendor lock-in, and slightly less control over the pipeline.

---

## Migration Phases

### Phase 0: Containerize Current Pipeline (1-2 weeks)

- Dockerfile with CUDA support
- processor.py runs as-is, skip FaceKitRunner
- Test on cloud GPU instance
- No code changes, just packaging

### Phase 1: API Wrapper (2-4 weeks)

- TypeScript API gateway with job queue
- Upload → queue → Python worker → results to object storage
- Presigned URL-based video upload
- Progress tracking via polling or WebSocket

### Phase 2: Replace Legacy Internal Dependencies (1 week)

- Direct OpenAI/Anthropic SDK calls for intent classification
- Remove legacy internal dependencies
- All dependencies must be publicly available

### Phase 3: FaceKitRunner Replacement (4-8 weeks, if needed)

- Integrate MediaPipe Face Mesh
- Map MediaPipe landmarks to blend shape approximations
- Recalibrate mouth energy weights
- Validate against ARKit baseline

### Phase 4: Web Annotation UI (8-16 weeks)

- React-based timeline with canvas rendering
- Video player with annotation overlay
- Speech transcript editing
- Task Mode with constraints
- This is the biggest effort — the SwiftUI app is ~15k+ lines of sophisticated UI

### Phase 5: Replace Local Inference with APIs (optional)

- Swap Whisper for cloud transcription API
- Swap pyannote for cloud diarization
- Eliminates GPU worker requirement
- Trade-off: per-minute cost vs infrastructure cost

---

## Open Questions

1. **Do you need facial tracking in cloud?** If not, Phase 3 is unnecessary and you can deploy much sooner.

2. **Is the SwiftUI app staying?** If desktop annotation is sufficient and cloud is only for processing, you can skip Phase 4 entirely and just serve results to the existing app.

3. **Cost model**: Local GPU inference is cheaper at scale but requires infrastructure management. Cloud APIs are simpler but cost per minute adds up. The breakeven depends on volume.

4. **Per-speaker transcription in cloud**: MLX Whisper is Apple Silicon-only, but the `StereoTranscriber` calls it via subprocess. Swapping to `faster-whisper` (CUDA-optimized) would be straightforward — same CLI pattern, different binary.

5. **Multi-tenancy**: Current pipeline assumes single-user, local filesystem. Cloud deployment needs auth, isolation, and potentially per-tenant resource limits.

6. **Data residency**: Video recordings of people are sensitive. Cloud deployment needs to account for where data is stored and processed, especially if recordings contain identifiable individuals.
