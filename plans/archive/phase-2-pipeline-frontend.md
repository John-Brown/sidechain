# Phase 2: Full Pipeline + Frontend Wiring

## Context

Phase 1 delivered the monorepo skeleton, full DB schema, Supabase auth, tRPC API, S3 upload helpers, and a working VAD stage on Modal. However the **frontend is entirely unwired** — pages have UI scaffolding but no tRPC calls, upload simulates progress, and there's no project selection flow. Only VAD has a Modal function; the other 6 pipeline stages don't exist.

Phase 2 makes the system **end-to-end functional in the browser**: upload a video, watch all 7 stages process automatically, view results.

**Deliverable**: Upload video → all 7 pipeline stages auto-execute via DAG orchestration → view results per stage.

---

## 1. Architecture Decisions

### Orchestration: DB-driven DAG (no Trigger.dev yet)

Skip Trigger.dev for now. The `processing_jobs` table already tracks per-stage status. A simple dependency resolver in the callback handler chains stages:

```
When stage X completes:
  1. Update processing_jobs.status = 'completed'
  2. For each stage Y that depends on X:
     if ALL of Y's prerequisites are 'completed' → trigger Y
```

**DAG** (hardcoded, 7 nodes):
```
vad ─────────────────────────────→ diarization → state_annotation → intent_classification
transcription ──────────────────────────────────────────────────────→ intent_classification
facial_tracking → mouth_energy → diarization
```

Dependencies lookup:
| Stage | Depends On |
|-------|-----------|
| vad | — |
| transcription | — |
| facial_tracking | — |
| mouth_energy | facial_tracking |
| diarization | vad, mouth_energy |
| state_annotation | diarization |
| intent_classification | state_annotation, transcription, vad |

Trigger.dev can be added in Phase 4 when human-in-the-loop pauses (`waitForEvent`) are needed.

### Processing: Modal web endpoints, callback-driven

Each pipeline stage is a Modal `@web_endpoint`. The existing pattern works:
1. Backend inserts `processing_jobs` row → POST to Modal endpoint
2. Modal processes → POSTs back to `/api/processing/callback`
3. Callback updates job + triggers dependent stages

### Project bootstrap

The `videos.list` procedure requires `projectId`, but there's no project creation UI. Added a minimal project CRUD router + simple project selector in the layout. For single-user dev, auto-creates a default project on first login.

---

## 2. Implementation Waves

### Wave 1: Wire Frontend (make Phase 1 work in browser)

**Goal**: Upload → VAD → view results works end-to-end.

- Wire VideoUpload to real S3 multipart upload via tRPC
- Wire videos list page to tRPC `videos.list` with project context
- Wire video detail page with tRPC, polling, results viewing
- Create projects tRPC router (list, create, getOrCreateDefault)
- Add project selector to layout sidebar
- Create active project runes store
- Fix tRPC client missing superjson transformer

### Wave 2: Pipeline Stages (Modal functions)

**Goal**: All 7 pipeline stages have working Modal endpoints.

- Extract shared S3/audio utils from vad.py
- Update VAD with 10Hz frame data (per-window speech probabilities)
- Implement 6 new stages: transcription, facial_tracking, mouth_energy, diarization, state_annotation, intent_classification
- Update modal_app.py with all endpoints, separate images per resource profile
- Add generic StageRequest/StageResponse models

### Wave 3: DAG Orchestration + Generalized Trigger

**Goal**: Upload auto-triggers full pipeline. Stages chain via callback.

- Create DAG resolver (dag.ts) with dependency graph and getReadyStages()
- Create generic triggerStage() function (trigger.ts)
- Replace triggerVAD with triggerPipeline (creates 7 jobs, fires roots)
- Add retryStage mutation
- Update callback to chain dependent stages on completion
- Wire "Process All" button in video detail page

---

## 3. File Inventory

### Created (new)
| File | Purpose |
|------|---------|
| `apps/web/src/lib/server/trpc/routers/projects.ts` | Project CRUD (list, create, getOrCreateDefault) |
| `apps/web/src/routes/projects/+page.svelte` | Project list + create form |
| `apps/web/src/lib/stores/project.svelte.ts` | Active project runes store |
| `apps/web/src/lib/server/pipeline/dag.ts` | Stage dependency graph + resolver |
| `apps/web/src/lib/server/pipeline/trigger.ts` | Generic stage trigger (POST to Modal) |
| `workers/ml-pipeline/stages/utils.py` | Shared S3 + audio utilities |
| `workers/ml-pipeline/stages/transcription.py` | Whisper large-v3 via faster-whisper |
| `workers/ml-pipeline/stages/facial_tracking.py` | MediaPipe Face Mesh |
| `workers/ml-pipeline/stages/mouth_energy.py` | Mouth blend shape energy |
| `workers/ml-pipeline/stages/diarization.py` | pyannote.audio 3.1 |
| `workers/ml-pipeline/stages/state_annotation.py` | Rule-based state derivation |
| `workers/ml-pipeline/stages/intent_classification.py` | Claude API intent classification |

### Modified (existing)
| File | Changes |
|------|---------|
| `apps/web/src/lib/trpc.ts` | Added superjson transformer |
| `apps/web/src/lib/components/upload/VideoUpload.svelte` | Real S3 multipart upload via tRPC |
| `apps/web/src/routes/videos/+page.svelte` | Wire tRPC videos.list, project context |
| `apps/web/src/routes/videos/[id]/+page.svelte` | Wire tRPC, polling, Process All button |
| `apps/web/src/lib/server/trpc/router.ts` | Add projects router |
| `apps/web/src/routes/+layout.svelte` | Project selector in sidebar |
| `apps/web/src/lib/server/trpc/routers/processing.ts` | triggerPipeline, retryStage, generalized |
| `apps/web/src/routes/api/processing/callback/+server.ts` | Chain dependent stages on completion |
| `workers/ml-pipeline/modal_app.py` | 7 web endpoints, 6 images, StageRequest |
| `workers/ml-pipeline/stages/vad.py` | Shared utils, 10Hz frames |
| `workers/ml-pipeline/pyproject.toml` | New dependencies |

---

## 4. Stage Specifications

### S3 Result Keys
```
results/{videoId}/voice_activity.json
results/{videoId}/speech_transcription.json
results/{videoId}/facial_tracking.json
results/{videoId}/mouth_energy.json
results/{videoId}/diarization.json
results/{videoId}/annotations.json
results/{videoId}/intent_classification_annotations.json
```

### Stage Input Contracts (s3_keys_in)
- **vad**: `{"video": "..."}`
- **transcription**: `{"video": "..."}`
- **facial_tracking**: `{"video": "..."}`
- **mouth_energy**: `{"facial_tracking": "..."}`
- **diarization**: `{"video": "...", "vad": "...", "mouth_energy": "..."}`
- **state_annotation**: `{"diarization": "..."}`
- **intent_classification**: `{"states": "...", "transcription": "...", "vad": "..."}`

### Modal Resources
| Stage | Image | GPU | Memory | Timeout |
|-------|-------|-----|--------|---------|
| vad | torch+torchaudio | — | 2048 | 600 |
| transcription | faster-whisper | A10G | 4096 | 1200 |
| facial_tracking | mediapipe+opencv | — (4 CPU) | 4096 | 1800 |
| mouth_energy | numpy | — | 1024 | 300 |
| diarization | pyannote+torch | A10G | 4096 | 1200 |
| state_annotation | numpy | — | 1024 | 300 |
| intent_classification | anthropic | — | 1024 | 900 |

### Required Modal Secrets
- `aws-credentials` — all stages
- `huggingface` — diarization (pyannote model access)
- `anthropic` — intent classification (Claude API)

---

## 5. Environment Variables (additions)

```bash
# Modal (base URL for multi-endpoint)
MODAL_BASE_URL=https://your-workspace--annotation-pipeline.modal.run

# Anthropic (intent classification)
ANTHROPIC_API_KEY=sk-ant-...

# HuggingFace (pyannote.audio model access)
HF_TOKEN=hf_...
```
