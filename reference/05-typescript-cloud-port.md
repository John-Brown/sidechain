# TypeScript Cloud Port: Viability & Cost Analysis

> **Date:** February 2026
> **Status:** Research / Proposal
> **Constraint:** No Apple-internal tooling. All dependencies must be publicly available open-source or commercial services.

## What Exists Today

| Component | Language | Files | LOC |
|-----------|----------|-------|-----|
| Visualization App (macOS) | Swift/SwiftUI | 136 | ~37,000 |
| Processing Pipeline | Python | ~40 | ~12,000 |
| Analyst Report | Python | 10 | ~600 |
| LLM Annotation | Python | 12 | ~800 |
| **Total** | | **~200** | **~50,000** |

The system has two fundamentally different halves: a **Python ML pipeline** that processes video through 7 stages (VAD -> transcription -> facial tracking -> diarization -> states -> intents -> backchannels), and a **SwiftUI desktop app** for visualizing and correcting those annotations. They communicate through JSON files on a shared filesystem (Box Drive).

### Current Pain Points

- Annotators need macOS with Apple Silicon
- No real-time collaboration (file-based sync via Box Drive)
- Task assignment is manual; no centralized quality control
- Processing requires local GPU and model setup
- FaceKitRunner is a macOS-only binary
- Dependencies on Apple-internal tooling (TagKit/TagKitUI, AppleConnect auth, Interlinked/Floodgate SDK)

### Apple-Internal Dependencies to Replace

| Dependency | Current Usage | Public Replacement |
|------------|--------------|-------------------|
| TagKit / TagKitUI | Annotation tag rendering and editing UI | Custom React components |
| AppleConnect auth | Task Mode authentication for crowdsourcing | Clerk, Auth0, or Supabase Auth (OAuth2/OIDC) |
| Interlinked SDK | Wraps Anthropic/OpenAI API calls through internal proxy | Direct `@anthropic-ai/sdk` + `openai` npm SDKs |
| Floodgate API | Unified LLM endpoint | Direct provider APIs or LiteLLM for unified routing |
| FaceKitRunner (ARKit) | Facial tracking — 51 blend shapes, head pose, gaze | **Research needed** — see [Facial Tracking Replacement](#facial-tracking-replacement-research-needed) |
| Shasta repo | Hosts TagKit dependency | Eliminated — custom UI replaces it |
| Sparkle | macOS app updates | N/A for web deployment |

---

## Processing Pipeline: What Ports and What Doesn't

### Easy Ports (direct TS equivalents exist)

| Component | Current | TS Path | Notes |
|-----------|---------|---------|-------|
| Silero VAD | PyTorch model, 16kHz/100ms windows | `@ricky0123/vad-node` or `onnxruntime-node` + official Silero ONNX | Same model, officially published as ONNX. Stereo energy calc is pure RMS math. |
| FFmpeg | `ffmpeg-python` wrapper | `fluent-ffmpeg` | Same binary underneath, just a wrapper change |
| LLM intent classification | Anthropic/OpenAI via Interlinked/Floodgate | `@anthropic-ai/sdk` + `openai` npm (direct) | Both SDKs are TypeScript-first. Eliminates Interlinked dependency entirely. |
| State annotation | Rule-based (diarization -> speaking/listening) | Direct port | Pure logic, no models, ~200 lines |
| Mouth energy | Weighted blend shape deviation | Direct port | Pure math on already-computed data |

### Moderate Ports (viable but require validation)

| Component | Current | TS Path | Risk |
|-----------|---------|---------|------|
| Whisper transcription | `openai-whisper` large-v3, local | OpenAI Whisper API or `whisper-node` (whisper.cpp native addon) | API path loses per-word confidence scores. `whisper-node` on CUDA preserves everything but needs GPU hosting. |
| Facial tracking | FaceKitRunner (ARKit binary) | See [research section below](#facial-tracking-replacement-research-needed) | Needs empirical quality validation |
| PyTorch/MLX runtime | Model inference, audio I/O | `onnxruntime-node` with CUDA EP | MLX is irrelevant for cloud (Apple Silicon only). ONNX exports exist for Silero and Whisper. |

### Impractical to Port — Must Stay Python

| Component | Why | Recommended Approach |
|-----------|-----|---------------------|
| pyannote.audio (diarization) | Multi-model neural pipeline (PyanNet segmentation + ECAPA-TDNN embeddings + agglomerative clustering). No ONNX pipeline exists. No JS equivalent at comparable quality. | Python microservice behind FastAPI. Single endpoint: audio in -> speaker segments out. |
| Fast-MNMF source separation | `pyroomacoustics` has no JS port. Used for per-speaker transcription from stereo audio. | Keep in same Python service, or drop if per-speaker transcription isn't needed for cloud deployment. |

**Bottom line:** ~70% of the pipeline has viable TS paths. Diarization is the hard wall — it stays Python regardless.

---

## Facial Tracking Replacement (Research Needed)

> **Status:** Requires empirical validation before committing

FaceKitRunner uses Apple's ARKit framework and is macOS-only. It outputs:
- 51 blend shapes (facial muscle activation coefficients, 0.0-1.0)
- Head pose (rotation matrix -> pitch/yaw/roll in degrees)
- Gaze direction (3D lookat vector -> yaw/pitch in radians)
- 2D facial landmarks with quality filtering
- Per-frame confidence scores

### Candidate: MediaPipe Face Landmarker

Google's MediaPipe Face Landmarker (`@mediapipe/tasks-vision`) is the closest public equivalent:

| Feature | FaceKitRunner (ARKit) | MediaPipe Face Landmarker |
|---------|----------------------|--------------------------|
| Blend shapes | 51 | 52 (ARKit-compatible naming) |
| Head pose | Yes (rotation matrix) | Yes (rotation matrix from face geometry) |
| Gaze direction | Yes (3D lookat vector) | Partial (iris landmarks, no direct gaze vector) |
| Facial landmarks | 2D with quality metrics | 478 3D mesh points |
| Platform | macOS only | Cross-platform (browser, Node.js, Python) |
| License | Proprietary (Apple) | Apache 2.0 |

**What looks promising:**
- Blend shape names match ARKit conventions (`jawOpen`, `mouthSmileLeft`, etc.)
- Head pose derivable from face geometry
- Runs on CPU at ~30ms/frame
- The `mouth_energy_processor.py` downstream consumer only reads blend shape arrays by name — should work with MediaPipe output

**What needs validation:**
- Coefficient magnitude parity — do MediaPipe and ARKit produce similar values for the same facial expressions? Different training data and model architectures may produce different scales.
- Quality at extreme head angles and low-resolution video
- Gaze estimation accuracy (iris-based approximation vs. ARKit's direct gaze tracking)
- Impact on downstream mouth energy calculations (which use empirically-tuned weights)

**Other candidates to evaluate:**
- OpenFace (17 Action Units, lower resolution than ARKit's 51 blend shapes)
- InsightFace (different data format, no ARKit-compatible blend shapes)
- Custom ONNX model trained on ARKit data (research project, not a quick win)

### Recommended Research Plan

1. Run MediaPipe and FaceKitRunner on 5-10 test videos from the existing corpus
2. Compare blend shape output distributions (mean, variance, correlation)
3. Run mouth energy processor on both outputs, compare energy curves
4. Evaluate gaze direction quality (if gaze tracking is used downstream)
5. Document any coefficient rescaling needed for parity
6. Decision: adopt MediaPipe, adopt with calibration layer, or find alternative

---

## Visualization App: Swift -> Web

### Feasibility by Component

**Video playback — Moderate:**
HTML5 `<video>` + `requestVideoFrameCallback()` (Chrome 83+, Safari 15.4+, Firefox 124+) provides per-frame callbacks with `mediaTime`. Seeking precision depends on keyframe intervals — typically within ~33ms at 30fps, sufficient for annotation at 10Hz data resolution. Use throttled `currentTime` updates (~30Hz) during scrubbing.

**Multi-track timeline — Hard:**
The 800-line `TimelineCoordinator` with coordinated zoom/pan/scrub and 7-level tick hierarchy is the single hardest UI piece. No existing library covers this use case. The rendering architecture maps well to a hybrid approach:

| Swift (Current) | Web (Proposed) |
|-----------------|----------------|
| SwiftUI `Canvas` + `.drawingGroup()` for data tracks | HTML Canvas 2D (voice activity, audio energy, gaze, head pose) |
| SwiftUI Views for interactive tracks | React DOM components (annotation blocks, word blocks) |
| `TimelineCoordinator` (time<->pixel math) | Zustand store — ports nearly 1:1 |
| `@EnvironmentObject` propagation | Zustand global stores (no prop drilling) |
| `UndoRedoManager` snapshot pattern | `zundo` middleware (same concept) |
| `DragGesture` for resize handles | `pointermove` + `requestAnimationFrame` |

Canvas 2D handles the data density easily — voice activity at 10Hz means 100-600 visible points at any zoom level. The 15MB facial tracking JSON parses in ~200-400ms; use a Web Worker.

**Drag-to-resize interactions — Hard (highest risk):**
`ResizableWordBlockView` and annotation edge-drag during video sync is a tight event loop. SwiftUI's `DragGesture` runs at display refresh rate with direct hardware access. Web requires careful throttling and `will-change: transform` for GPU compositing. **This is the interaction to prototype first.**

**Task Mode — Hard but not blocked:**
21 Swift files implementing temporal masking, constraint validation, metrics tracking, and recovery. Complex state management but no technical barrier. The constraint model maps directly to a database-driven assignment system.

**Existing annotation platforms (CVAT, Label Studio, VIA):**
None are close enough to serve as a foundation. The gap between spatial video annotation and Curator's multi-track temporal annotation is too large. Build custom.

**Real-time collaboration — Easy, and the biggest win:**
Yjs (CRDT) or Liveblocks provide conflict-free shared editing. Annotation data model maps cleanly to Yjs shared types. This transforms Curator from single-user desktop to collaborative platform.

**Offline/PWA — Moderate:**
Online-first is the right default for a crowdsourcing tool. Service workers + IndexedDB handle annotation data. Video files are the challenge (500MB-2GB each) — use OPFS for explicit offline downloads. Start online-only.

---

## Recommended Architecture

### Option B: TypeScript Frontend + Python ML Backend

This is the pragmatic choice. The processing pipeline works and the models are tuned. The real pain point is distribution.

```
+-----------------------------------------------------------+
|  Frontend: React 19 + Vite + TypeScript                   |
|  +-- Video player (HTML5 <video> + rVFC)                  |
|  +-- Canvas timeline (data tracks)                        |
|  +-- React annotation editor (interactive tracks)         |
|  +-- Task Mode (Zustand state machine)                    |
|  +-- Undo/redo (zundo)                                    |
|  +-- Real-time presence (Liveblocks or Yjs)               |
+-----------------------------------------------------------+
|  API: Node.js + tRPC or REST                              |
|  +-- Auth (Clerk) + role-based access                     |
|  +-- Annotation CRUD (PostgreSQL JSONB)                   |
|  +-- Job orchestration (BullMQ + Redis)                   |
|  +-- WebSocket progress streaming                         |
|  +-- S3 presigned URLs for video upload/playback          |
+-----------------------------------------------------------+
|  ML Workers: Python (containerized on Modal/RunPod)       |
|  +-- VAD + Whisper + pyannote diarization                 |
|  +-- Facial tracking (MediaPipe or alternative — TBD)     |
|  +-- Mouth energy + state annotation                      |
|  +-- LLM intent classification (direct API calls)         |
+-----------------------------------------------------------+
|  Data: PostgreSQL (Supabase) + S3/CloudFront              |
|  +-- Annotations, users, sessions, tasks -> PostgreSQL    |
|  +-- Facial tracking JSON (15MB) -> S3 (loaded on-demand) |
|  +-- Video files -> S3 + CDN                              |
+-----------------------------------------------------------+
```

### Pipeline Orchestration

The 7-stage pipeline maps to BullMQ queues with human-in-the-loop pauses:
- Stages 1, 3, 5 (AI): auto-triggered, run on GPU workers
- Stages 2, 4, 6, 7 (Human): job sits in "awaiting verification" state -> WebSocket notifies assigned annotator -> human completes in web UI -> next stage triggers

### Role Model

```
Organization
+-- Admin: manage members, projects, settings, view analytics
+-- Supervisor: assign sessions, review quality, override annotations
+-- Annotator: view assigned sessions, complete assigned stages (Task Mode)
```

### Why Not the Other Options

**Option A (Pure TypeScript):** Not truly pure — diarization sidecar is always Python. Porting working Python ML code to TS buys zero model quality improvement and introduces risk. 4-5 months for marginal benefit over Option B.

**Option C (Managed APIs):** No managed API provides ARKit-compatible facial blend shapes. AssemblyAI replaces Whisper+diarization but loses per-speaker transcription, visible speaker detection, and model parameter control. Higher per-video cost. Viable as a "lite" mode, not as primary path.

---

## Cost Model

### Per-Video Processing (10-minute video)

| Component | Resource | Cost |
|-----------|----------|------|
| VAD (Silero) | CPU, ~30s | $0.001 |
| Transcription (Whisper large-v3) | GPU T4, ~5-8min | $0.08-0.15 |
| Diarization (pyannote) | GPU T4, ~3-5min | $0.05-0.08 |
| Facial tracking | CPU, ~15-20min | $0.02-0.05 |
| Intent classification | LLM API calls | $0.10 |
| S3 storage + transfer | — | $0.02 |
| **Total per video** | | **$0.27-0.40** |

### Monthly Infrastructure (100 videos/month)

| Service | Provider | Cost |
|---------|----------|------|
| Frontend hosting | Vercel Pro | $20 |
| API server | Railway or Fly.io | $20-40 |
| PostgreSQL | Supabase Pro | $25 |
| Redis (BullMQ) | Upstash | $15-30 |
| S3 + CDN | AWS | $10-20 |
| GPU compute | Modal (~35 GPU-hrs T4) | $20-40 |
| LLM API | Anthropic (direct) | $10-20 |
| **Total** | | **$120-200/month** |

At 500 videos/month: ~$250-400/month (GPU scales, infrastructure stays flat).

---

## What You Gain

| Benefit | Impact |
|---------|--------|
| Cross-platform access | Annotators need a browser, not macOS + Apple Silicon |
| No Apple-internal deps | Fully portable, open-source or commercial dependencies only |
| Real-time collaboration | Multiple annotators on same video simultaneously |
| Centralized task management | Server-side queue replaces Box Drive sync + manual assignment |
| Cloud processing | Scale workers dynamically; no local GPU/model setup |
| Quality control at scale | Inter-annotator agreement metrics, supervisor dashboards |
| Zero-install deployment | No Swift builds, no venv, no FaceKit quarantine removal |

## What You Lose or Risk

| Cost | Impact |
|------|--------|
| Facial tracking quality | Replacement TBD — needs research. See [section above](#facial-tracking-replacement-research-needed). |
| Video playback precision | HTML5 video is good, not AVFoundation-grade. ~33ms vs sub-frame. |
| Drag interaction feel | Web drag is clunkier than SwiftUI gestures. Careful engineering required. |
| Offline-first model | Current app works fully offline. Web is online-first with offline as fallback. |
| Per-word confidence scores | Lost if using Whisper API; preserved with `whisper-node`. |
| 3-4 months of engineering | No new features shipping during the port. |
| Two-language backend | Python diarization sidecar persists regardless of TS ambitions. |

---

## Migration Path

### Phase 0 — De-risk spike (1-2 days)
Build a single resizable annotation block on a Canvas/DOM timeline with `<video>` sync. Evaluate whether the drag-to-resize interaction quality meets your bar. This validates or kills the entire effort.

### Phase 1 — Read-only web viewer (6 weeks)
Video playback, timeline rendering, annotation viewing. Load existing JSON annotation files. Validate performance with real data volumes.

### Phase 2 — Editing + Task Mode (4 weeks)
Annotation editing, word block resize, undo/redo, Task Mode constraints. Match current editing capability.

### Phase 3 — Processing API (3 weeks)
Containerize Python workers on Modal. BullMQ job queue. WebSocket progress streaming. Video upload to S3.

### Phase 4 — Multi-user (2 weeks)
Clerk auth, role-based access, task assignment, real-time presence.

---

## Decision Framework

The question isn't "can this be ported" — it can, with the diarization caveat. The question is whether the **collaboration and distribution benefits** justify 3-4 months of engineering against a working system.

If you're scaling the annotator pool beyond a handful of macOS users, the answer is yes. The hybrid architecture preserves the ML pipeline you've already validated while unlocking the web distribution model and eliminating Apple-internal dependencies.

**Highest-priority research item:** Facial tracking replacement. Run MediaPipe vs FaceKitRunner comparison on existing test videos before committing to the port.
