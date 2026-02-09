# Curator Web: Browser-Based Video Annotation Platform

## Context

Curator is a human-AI collaborative annotation system for social interaction analysis. It currently exists as reference documentation (~50K LOC spec) describing a 7-stage ML pipeline (Python) and a macOS-native visualization app (Swift/SwiftUI). The pipeline alternates AI automation with human validation: VAD, transcription, facial tracking, diarization, state annotation, intent classification, and backchannel tagging.

**Goal**: Build a browser-based version that replaces the macOS-only workflow, enabling crowdsourced annotators to review and correct AI-generated annotations on uploaded videos. Start with a working foundation and iteratively add pipeline stages.

**Key constraint**: ~70% of the ML pipeline is already Linux-portable. The hard walls are pyannote.audio (diarization, must stay Python) and FaceKitRunner (ARKit, replaced by MediaPipe). The web UI is a full rebuild -- no existing annotation tool covers temporal multi-track editing.

---

## Architecture

```
Browser (Annotator)
  │
  ├── SvelteKit App (SSR + SPA)
  │   ├── Video player + timeline annotation editor
  │   ├── Task Mode (constrained editing for crowdsourcing)
  │   └── Admin/supervisor dashboards
  │
  ├── tRPC API (type-safe, SSE for progress)
  │
Vercel (Frontend + API)
  │
  ├── Supabase (PostgreSQL + Auth + Realtime)
  │   ├── Users, roles, projects, tasks
  │   ├── Editable annotations (states, intents, backchannels) as JSONB
  │   └── Row-level security for annotator isolation
  │
  ├── AWS S3 + CloudFront
  │   ├── Video files (multipart upload, signed URL delivery)
  │   └── Large read-only data (facial tracking ~15MB, VAD ~500KB)
  │
  ├── Trigger.dev (Pipeline orchestration)
  │   ├── DAG execution with human-in-the-loop pauses
  │   └── waitForEvent at each human validation stage
  │
  └── Modal (GPU compute, scale-to-zero)
      ├── VAD (CPU, ~2 min)
      ├── Whisper transcription (T4 GPU, ~10 min)
      ├── MediaPipe facial tracking (CPU, ~3 min)
      ├── Mouth energy (CPU, instant)
      ├── Diarization (T4 GPU, ~30 min)
      ├── State annotation (CPU, instant)
      └── Intent classification (CPU, Anthropic API, ~5 min)
```

### Pipeline DAG

```
Video ──→ VAD ────────────────────┐
     ├──→ Whisper ────────────────┤
     └──→ MediaPipe facial ─→ Mouth energy ─┐
                                  │          │
                           Diarization ←─────┘
                                  │
                           State annotation
                                  │
                     [HUMAN: verify states]
                                  │
                        Intent classification
                                  │
                     [HUMAN: verify intents]
                                  │
                     [HUMAN: tag backchannels]
```

---

## Technology Stack

| Layer | Choice | Reasoning |
|-------|--------|-----------|
| **Framework** | **SvelteKit 2** | Compile-time reactivity eliminates VDOM overhead during 60fps timeline interactions. Built-in stores map 1:1 to the TimelineCoordinator pattern. Smaller bundle leaves more room for ML model/data loading. SSR where useful (dashboards, login), SPA where needed (annotation editor). |
| **API** | **tRPC** | End-to-end TypeScript type safety without codegen. Subscriptions (SSE) for processing progress. Lightweight for solo maintainer. |
| **Database** | **Supabase Pro** ($25/mo) | PostgreSQL + Auth + Realtime in one service. RLS for annotator isolation. 100K MAU included. JSONB for annotation storage (preserves existing format). |
| **Auth** | **Supabase Auth** | Integrated with DB, JWT + RLS, email/password for annotators, OAuth optional. |
| **Video storage** | **AWS S3 + CloudFront** | Multipart upload for files up to 2GB. Signed URLs for CDN delivery. No upload size limits (unlike Supabase Storage). |
| **Pipeline orchestration** | **Trigger.dev** ($10-25/mo) | Durable workflows with DAG support. `waitForEvent` for human-in-the-loop pauses. TypeScript-native. |
| **GPU compute** | **Modal** (pay-per-second) | Scale-to-zero. Models baked into container images (no cold-start download). Per-second billing keeps costs proportional to usage. |
| **Facial tracking** | **MediaPipe Face Mesh** | 52 blend shapes with ARKit-compatible naming. The 10 mouth shapes used for mouth energy map directly -- no weight recalibration. Cross-platform (Linux, browser, Node). |
| **LLM (intents)** | **Anthropic SDK** (direct) | Replaces apple-interlinked. Claude 4.5 Sonnet for intent classification. |
| **Frontend deploy** | **Vercel Pro** ($20/mo) | Native SvelteKit adapter. Preview deployments per PR. Edge functions for API routes. |
| **Styling** | **Tailwind CSS 4** | Utility-first, pairs well with Svelte. |
| **UI components** | **Skeleton UI** (Svelte) | Modals, dropdowns, tables -- the non-custom parts. |

### Why SvelteKit over Next.js

The annotation editor is the critical path. It requires:
- `currentTime` updates at 30-60Hz via `requestVideoFrameCallback` -- Svelte's compiled reactivity avoids React's reconciliation cost on every frame
- Drag-to-resize at 60fps -- direct DOM mutation without `useCallback`/`useMemo` ceremony or stale closure bugs
- Hundreds of positioned DOM elements (annotation blocks) updating during zoom/pan -- fine-grained reactivity beats virtual DOM diffing

The heavy lifting (Canvas tracks, pointer event handling) is framework-agnostic. The ecosystem gap is negligible since no existing library covers temporal annotation editing -- it's all custom regardless.

**Fallback**: If hiring for Svelte becomes a bottleneck, the Canvas/DOM rendering layer ports to React with Zustand stores. The framework choice affects the shell, not the core interaction code.

---

## Monorepo Structure

```
annotation/
├── apps/
│   └── web/                      # SvelteKit app
│       ├── src/
│       │   ├── lib/
│       │   │   ├── server/       # tRPC routers, DB queries, S3 helpers
│       │   │   ├── components/   # Svelte components
│       │   │   │   ├── editor/   # AnnotationEditor, Timeline, VideoPlayer
│       │   │   │   ├── tracks/   # CanvasTrack, InteractiveTrack, blocks
│       │   │   │   └── task/     # TaskMode overlay, controls
│       │   │   └── stores/       # timeline, annotation, session stores
│       │   └── routes/           # SvelteKit pages
│       └── svelte.config.js
├── packages/
│   ├── db/                       # Drizzle ORM schema + migrations
│   ├── shared/                   # Annotation format types, pipeline types
│   └── trigger/                  # Trigger.dev workflow definitions
├── workers/
│   └── ml-pipeline/              # Python Modal functions
│       ├── modal_app.py
│       └── stages/               # vad.py, transcription.py, etc.
├── supabase/                     # Migrations, RLS policies
├── turbo.json
└── pnpm-workspace.yaml
```

---

## Annotation Editor Architecture

The editor is the core of the product. Hybrid rendering: **Canvas for read-only data tracks, DOM for interactive annotation tracks.**

### Rendering Split

| Track | Rendering | Interactive? | Data source |
|-------|-----------|-------------|-------------|
| Time ruler | Canvas | Click-to-seek | Derived from duration |
| VAD waveform | Canvas | Read-only | S3 JSON (~500KB) |
| Audio energy | Canvas | Read-only | S3 JSON |
| Diarization | Canvas | Read-only | PostgreSQL JSONB |
| Mouth energy | Canvas | Read-only | S3 JSON (~300KB) |
| Facial tracking | Canvas | Read-only | S3 JSON (~15MB, Web Worker parse) |
| **Transcription** | **DOM** | **Drag-resize word blocks** | PostgreSQL JSONB |
| **States** | **DOM** | **Drag-resize, classify** | PostgreSQL JSONB |
| **Intents** | **DOM** | **Drag-resize, classify** | PostgreSQL JSONB |
| **Backchannels** | **DOM** | **Create, delete** | PostgreSQL JSONB |

### Video-Timeline Sync

```
<video> element
  │  requestVideoFrameCallback (30-60Hz)
  ▼
timelineStore.currentTime ($store auto-subscription)
  ├──→ Playhead CSS position
  ├──→ Canvas tracks redraw (rAF batched)
  ├──→ Auto-scroll (keep playhead visible)
  └──→ Inspector panel update
```

### Drag-to-Resize Strategy (highest risk interaction)

1. `pointerdown`: capture target, enter drag mode, suppress reactivity
2. `pointermove`: throttle to rAF, update ONLY the dragged element's inline style (no store update, no re-render)
3. `pointerup`: compute final time, commit to annotationStore, push undo snapshot

During drag: exactly one DOM mutation per frame on a `will-change: transform` GPU-composited layer.

### State Management

Three stores with distinct update frequencies:

- **`timelineStore`**: Viewport geometry, currentTime, zoom/pan -- updates at 30-60Hz during playback
- **`annotationStore`**: Mutable annotation data + undo/redo stack -- updates on user edits (seconds to minutes apart)
- **`sessionStore`**: Read-only session metadata, video URL, visualization data, Task Mode config -- loaded once

Separation prevents `currentTime` updates from triggering annotation list re-evaluation.

---

## Database Schema (key tables)

- **`profiles`**: user_id, display_name, role (admin/supervisor/annotator)
- **`projects`**: organizational grouping for videos
- **`videos`**: s3_key, duration, status (uploading/processing/ready/error), processing_config
- **`processing_jobs`**: video_id, stage, status, progress (0-1), result_s3_key, error_message
- **`annotation_sets`**: video_id, type (state/intent/backchannel), version (optimistic locking), data (JSONB) or s3_key (large files)
- **`annotation_edits`**: audit log (edit_type, before_state, after_state, user_id, timestamp)
- **`tasks`**: video_id, task_type, status, assigned_to, constraints (JSONB), time_spent, review_notes

RLS policies enforce: annotators see only assigned tasks/videos, supervisors see project scope, admins see all.

---

## Cost Model

### Per-Video Processing (~10 min video)

| Stage | Resource | Cost |
|-------|----------|------|
| VAD | 2 CPU, 2 min | $0.002 |
| Whisper | T4 GPU, 10 min | $0.13 |
| MediaPipe facial | 4 CPU, 3 min | $0.01 |
| Mouth energy | 1 CPU, 10s | ~$0 |
| Diarization | T4 GPU, 30 min | $0.40 |
| State annotation | CPU, instant | ~$0 |
| Intent classification (LLM) | Anthropic API | $0.05-0.15 |
| **Total per video** | | **~$0.60-0.70** |

### Monthly Infrastructure

| Scale | Videos/mo | Annotators | Cost/mo |
|-------|-----------|------------|---------|
| Pilot | 20 | 5-10 | ~$100-130 |
| Growth | 100 | 50 | ~$180-280 |
| Full | 500 | 200 | ~$350-500 |

---

## Phased Roadmap

### Phase 0: De-Risk Spike (3-4 days)

**Validates or kills the approach before committing.**

Build a standalone HTML page with:
- `<video>` + `requestVideoFrameCallback` sync
- One Canvas waveform track (load real `voice_activity.json` from reference data)
- One DOM track with 20 resizable blocks
- Drag-to-resize synced to video playback
- Measure p95 frame time during drag with 50+ visible blocks

**Gate**: p95 frame time < 20ms = proceed. If not, investigate alternatives before committing to the architecture.

### Phase 1: Skeleton + Single Pipeline Stage (Weeks 1-2)

- Initialize monorepo (Turborepo + pnpm)
- SvelteKit with Supabase Auth (email/password)
- Database schema via Drizzle ORM
- S3 multipart upload flow (presigned URLs, browser chunking)
- Single Modal function: VAD (simplest, CPU-only)
- Manual trigger: upload video, click process, see VAD JSON result

**Deliverable**: Admin uploads a video, triggers VAD, views raw results.

### Phase 2: Full Pipeline (Weeks 3-5)

- All 7 ML stages as Modal functions
- MediaPipe replacing FaceKitRunner (validate blend shape parity)
- Anthropic SDK replacing apple-interlinked for intent classification
- Trigger.dev DAG orchestration with progress polling
- Video list with per-stage processing status

**Deliverable**: Upload triggers full automated pipeline. All annotation JSONs generated.

### Phase 3: Annotation Viewer (Weeks 6-9)

- Video player with `requestVideoFrameCallback`
- Multi-track Canvas timeline (VAD, energy, diarization, mouth energy, facial data)
- DOM-based annotation display (states, intents, transcription word blocks)
- Playhead scrubbing synced to video
- Data loading: PostgreSQL for annotations, S3 for large visualization data
- Web Worker for parsing 15MB facial tracking JSON

**Deliverable**: Annotators view videos with all tracks overlaid. Read-only.

### Phase 4: Editing + Task Mode (Weeks 10-13)

- Annotation CRUD (create, resize, delete, split, merge, classify)
- Drag-to-resize on word blocks and annotation blocks
- Undo/redo (snapshot-based, ~50 LOC)
- Task Mode: constrained editing (locked regions, allowed categories, role lock)
- Task submission triggers next pipeline stage via Trigger.dev `waitForEvent`
- Auto-save (30s debounce) + localStorage fallback
- Annotation edit audit log

**Deliverable**: Full human-in-the-loop workflow. AI proposes, annotators correct.

### Phase 5: Multi-User + Quality Control (Weeks 14-16)

- Role-based access (admin, supervisor, annotator)
- Task assignment dashboard (supervisor assigns video+stage to annotators)
- Per-annotator metrics (tasks/hour, edit count, time spent, rejection rate)
- Inter-annotator agreement (Cohen's kappa for categories, boundary IoU for temporal alignment)
- Supervisor review workflow (approve/reject with notes)
- Bulk task assignment

**Deliverable**: Production crowdsourcing for 50+ annotators.

### Phase 6: Polish + Scale (Weeks 17-20)

- Error handling: retry failed stages, dead letter queue
- CloudFront signed URLs (time-limited, per-user)
- Export in Curator JSON format (backward compatibility)
- Analytics dashboard (processing throughput, cost tracking)
- Load testing with 50 concurrent annotators
- Annotator onboarding documentation
- S3 lifecycle rules (Intelligent-Tiering, Glacier after 90 days)

**Deliverable**: Production-ready for 200 annotators, 500 videos/month.

---

## Key Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Drag-to-resize jank on web | HIGH | Phase 0 spike validates before any investment. Fallback: form-based time editing instead of direct manipulation. |
| MediaPipe blend shape parity with ARKit | MEDIUM | Run both on 5-10 test videos in Phase 2. Compare mouth energy distributions. Calibration weights are just 10 floats if adjustment needed. |
| 15MB facial tracking JSON parse blocking UI | MEDIUM | Web Worker parse + transfer only needed subset (10 blend shapes, head pose) via Transferable ArrayBuffers. |
| Two-language backend (TS + Python) | LOW | Clean boundary: Python workers are stateless containers (S3 in, S3 out). Zero shared state beyond job queue messages. Docker Compose for local dev. |
| Video seeking precision | LOW | `requestVideoFrameCallback` gives actual `mediaTime` after seek. 33ms precision is sufficient for 10Hz annotation data. Enforce 1s keyframe intervals on upload via server-side transcoding. |

---

## Verification Plan

### Phase 0 (De-risk)
- Frame time profiling in Chrome DevTools Performance tab
- Test on mid-range hardware (simulate annotator machines)

### Each Phase
- Unit tests: Vitest for store logic, time-to-pixel math, constraint validation
- E2E tests: Playwright for drag-to-resize, video sync, Task Mode flows
- Manual: load real annotation data from reference docs, verify visual correctness

### Pre-Production (Phase 5-6)
- Load test: 50 concurrent WebSocket connections to Supabase Realtime
- Process 10 videos end-to-end, verify output JSON matches Curator format
- Inter-annotator agreement on 5 test videos with known ground truth
- Cost validation: measure actual Modal spend vs estimates

---

## Critical Reference Files

- `reference/06-typescript-cloud-port.md` -- Component portability analysis, architecture options, cost model
- `reference/05-cloud-deployment-guidance.md` -- Platform coupling, migration phases, infrastructure breakdown
- `reference/02-algorithm-reference.md` -- Algorithm specs, I/O formats, model parameters (defines TypeScript types)
- `reference/03-data-flow.md` -- Unified JSON schema, time alignment conventions, dependency graph
- `reference/07-facial-tracking-reference.md` -- MediaPipe replacement strategy, blend shape mapping, mouth energy pipeline
- `reference/01-system-overview.md` -- 7-stage pipeline, human-AI collaboration model, Task Mode design
