# Phase 1: Skeleton + Single Pipeline Stage

## Status: COMPLETE

## Deliverable
Admin uploads a video, triggers VAD processing, views raw JSON results.

## What Was Built

### Monorepo Foundation
- pnpm workspaces + turborepo (`pnpm build` passes all 3 packages)
- `packages/shared/` — TypeScript types (annotation shapes, pipeline enums, zero runtime deps)
- `packages/db/` — Full Drizzle ORM schema (9 tables, 10 enums, all indexes)
- `apps/web/` — SvelteKit app (Svelte 5, Tailwind 4, shadcn-svelte v2)
- `workers/ml-pipeline/` — Python Modal functions (uv-managed)

### Database Schema (all tables, even if unused until later phases)
- profiles, projects, project_members (identity + organization)
- videos, processing_jobs (upload + pipeline tracking)
- annotation_sets, annotation_edits (versioned annotations + audit)
- tasks (human annotation workflow)
- annotator_metrics (QC, Phase 5)

### SvelteKit Application
- Supabase SSR auth (hooks.server.ts, login/signup pages)
- App shell with sidebar navigation
- Video list page + video detail page with pipeline status
- VideoUpload component (drag-drop, progress bar)
- tRPC client wired to server router

### Backend API
- tRPC v11 with superjson, protectedProcedure middleware
- Video CRUD + S3 multipart upload flow (presigned URLs)
- Processing trigger (insert job row → POST to Modal → update status)
- Processing callback endpoint (Modal webhook → update job status)
- S3 helpers (AWS SDK v3)

### ML Pipeline
- Modal web endpoint for VAD processing
- Silero VAD at 10Hz (100ms windows, 16kHz mono)
- Segment merging (300ms gap threshold)
- S3 download/upload, structured error handling
- Callback with shared secret auth

## Alignment with Phase 0 Architecture

### Aligned
- Monorepo structure matches plan (apps/web, packages/db, packages/shared, workers/ml-pipeline)
- Tech stack: SvelteKit, tRPC, Supabase Auth, S3, Modal, Drizzle ORM
- Schema covers full lifecycle (all tables defined now, not incrementally)
- Pipeline DAG dependencies captured in processing_jobs (one job per stage per video)
- S3 for large binary data, PostgreSQL JSONB for editable annotations

### Intentional Deviations from Phase 0 Doc
- **shadcn-svelte** instead of Skeleton UI — better Svelte 5 support, more actively maintained
- **Direct HTTP POST to Modal** instead of Trigger.dev — simpler for Phase 1 single-stage; Trigger.dev DAG orchestration deferred to Phase 2
- **Drizzle migrations** instead of `supabase/` directory — schema lives in packages/db, migrations generated via drizzle-kit
- No `packages/trigger/` yet — will be added when Trigger.dev is integrated

### VAD Output Format Divergence (NEEDS ATTENTION IN PHASE 2)
The reference spec defines VAD as **per-frame 10Hz windowed data**:
```json
{
  "time_range": {"start": 0.0, "end": 0.1},
  "voice_activity": {
    "speech_probability": 0.85,
    "energy_dbfs": -25.3,
    "energy_dbfs_left": -24.1,
    "energy_dbfs_right": -26.5
  }
}
```

Our Phase 1 VAD outputs **merged speech segments**:
```json
{
  "segments": [{"time_range": {"start": 2.1, "end": 3.8}, "confidence": 0.95}],
  "metadata": {"model": "silero-vad-v5", ...}
}
```

For Phase 2, we need BOTH:
1. Raw 10Hz frame data (for Canvas waveform visualization track)
2. Merged segments (for annotation layer)

The reference format also includes stereo energy (energy_dbfs_left/right) which we don't compute yet. FFmpeg stereo extraction should be added when we implement the full preprocessing stage.

### Shared Types vs Reference Format
The `@annotation/shared` types are comprehensive but use a slightly different structure than the reference JSON format. Key difference: the reference uses `metadata.algorithm` with flat fields like `window_size_ms`, while our types use nested `AlgorithmInfo` with `parameters` dict. This is fine — the types are for the web platform, not the reference pipeline. But the VAD output from Modal should match the reference format when stored in S3.

## Environment Prerequisites (Manual)
- Supabase project (URL + keys)
- AWS S3 bucket (credentials)
- Modal account + token
- `.env` populated from `.env.example`
