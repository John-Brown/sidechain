# Development Log

## 2026-02-07 — Phase 2 QA: Local Dev Setup + Pipeline Fixes

### What was done
- Set up local Supabase (Postgres + Auth + S3-compatible storage) for dev
- Fixed all `process.env` usages to SvelteKit `$env` imports (context.ts, trigger.ts, callback, s3.ts)
- Fixed Supabase SSR auth: rewrote context.ts to use `event.locals.safeGetSession()` + auto-create profile rows
- Fixed hooks.server.ts: call `getUser()` before `getSession()` to suppress Supabase auth warning
- Migrated to real AWS S3 (`sidechain-annotation-dev` bucket in us-west-2) for Modal accessibility
- Configured S3 CORS for browser-based multipart uploads from localhost

### Modal deployment fixes
- `modal.Mount` removed in v1.3+ — migrated to `image.add_local_python_source("stages", copy=True)`
- `@modal.web_endpoint` deprecated — replaced with `@modal.fastapi_endpoint`
- Added `fastapi[standard]` to all images
- Added `ffmpeg` + `libsndfile1` + `soundfile` to audio-processing images
- VAD: `torchaudio.load()` now requires torchcodec — replaced with ffmpeg + soundfile pipeline
- VAD: Silero VAD v5 window size changed from 1600 to 512 samples
- Facial tracking: `mp.solutions.face_mesh` removed — migrated to `mediapipe.tasks.python.vision.FaceLandmarker`
- Modal URL format: subdomain-per-function (`${BASE}-${FUNCTION}.modal.run`)

### Trigger architecture change
- Modal `@fastapi_endpoint` is synchronous (HTTP blocks until function completes)
- trigger.ts now: sets "running" before POST, parses response body for completed/failed
- tRPC mutations fire triggers with `.then()` (no await) so they return immediately
- `triggerReadyStages()` auto-cascades dependent stages after completion

### New features
- Video delete (UI + S3 cleanup + DB cascade)
- Refresh button on video detail page
- "In development" badge for stages not yet production-ready

### Stages status
| Stage | Status | Notes |
|-------|--------|-------|
| vad | Working | Silero VAD v5, ffmpeg + soundfile audio loading |
| transcription | Working | faster-whisper large-v3, GPU (A10G) |
| facial_tracking | Working | MediaPipe FaceLandmarker task API |
| mouth_energy | Working | Depends on facial_tracking output |
| diarization | In Development | pyannote `use_auth_token` API change needs fix |
| state_annotation | In Development | Depends on diarization |
| intent_classification | In Development | Depends on state_annotation + Anthropic API key |

### Known issues
- No tunnel for Modal callbacks — dependent stages auto-chain via `triggerReadyStages()` instead
- Diarization fails: `Pipeline.from_pretrained() got an unexpected keyword argument 'use_auth_token'`
- No favicon (404s on /favicon.ico, /apple-touch-icon.png — harmless)
