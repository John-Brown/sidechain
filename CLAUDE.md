# Sidechain

Video annotation pipeline: upload → ML processing → AI annotation → human validation → quality control.

## Project Status

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Spike/prototype | Complete (`spike/`) |
| 1 | Monorepo skeleton + schema + VAD pipeline | Complete |
| 2 | All 7 pipeline stages + DAG orchestration + frontend | Complete (waveform added later → now 8 stages: 5 working, 3 gated as in-dev) |
| 3 | Read-only timeline viewer (multi-track timeline, Canvas + DOM tracks, viewport culling) | Complete |
| 3.5 | Project management (detail page, members, guidelines, dashboard) | Complete |
| 4 | Annotation editing + task mode (human-in-the-loop) | Complete → `plans/archive/phase-4-editing-task-mode.md` (deferred: command-executor layer, router tests) |
| 4.1 | User labels track (freeform text annotations, drag-move, view persistence) | Complete |
| 4.2 | Viewer code review fixes (20 issues: data integrity, proxy safety, a11y, perf) | Complete → `plans/archive/viewer-code-review.md` |
| — | Post-4.2 viewer work: waveform + head-pose tracks, mesh overlay + depth, transcription LOD | Complete (see `plans/DEVLOG.md`) |

Last active: 2026-02-13. Health check 2026-09-24: `test` (270 passing), `check` (0 errors), `build` all green.

## Architecture

**Monorepo** (pnpm workspaces + turborepo):

| Package | Purpose |
|---------|---------|
| `apps/web` | SvelteKit app (Svelte 5, Tailwind 4) |
| `packages/shared` | TypeScript types (zero runtime deps) |
| `packages/db` | Drizzle ORM schema + migrations (postgres-js driver) |
| `workers/ml-pipeline` | Python Modal functions (uv-managed, independent of TS monorepo) |

## Tech Stack

- **Frontend**: SvelteKit, Svelte 5 (runes), Tailwind CSS 4, lucide-svelte icons, Inter Variable typeface. No component library in use: `components/ui/` is empty.
- **API**: tRPC v11 (server + client, superjson transformer)
- **Auth**: Supabase SSR (@supabase/ssr)
- **Database**: PostgreSQL via Supabase, Drizzle ORM
- **Storage**: S3 (multipart upload, presigned URLs, @aws-sdk/client-s3)
- **ML Pipeline**: Modal (Python, Silero VAD, WhisperX/faster-whisper, MediaPipe, Depth Anything V2, pyannote, Anthropic SDK)
- **Validation**: Zod

## Common Commands

```bash
pnpm install                    # Install all workspace deps
pnpm build                     # Build all packages (turbo)
pnpm dev                       # Dev mode all packages
pnpm --filter web dev          # Dev SvelteKit app only
pnpm --filter web build        # Build web app only
pnpm --filter db generate      # Generate Drizzle migration SQL
pnpm --filter db migrate       # Run migrations
pnpm --filter db studio        # Open Drizzle Studio
pnpm --filter web check        # Svelte type checking
pnpm --filter web test         # Vitest (CI); test:watch for dev
```

`packageManager` pins pnpm 9.15.0, but corepack isn't shipped with Node 25+, so nothing enforces the pin. Check `pnpm -v` yourself.

## Key File Locations

```
# Server
apps/web/src/hooks.server.ts           # Supabase auth middleware (getUser before getSession)
apps/web/src/lib/server/supabase.ts    # Server Supabase client
apps/web/src/lib/server/trpc/         # tRPC router, context, procedures
apps/web/src/lib/server/s3.ts         # S3 client (lazy init, supports S3_ENDPOINT for local dev)
apps/web/src/lib/server/pipeline/     # DAG orchestration + stage trigger

# Client
apps/web/src/lib/trpc.ts              # Browser tRPC client
apps/web/src/lib/supabase.ts          # Browser Supabase client

# Project management — route: /projects/[id] (tabbed: overview, settings, members, guidelines)
apps/web/src/lib/components/project/  # Project detail components
  ProjectOverview.svelte              #   Dashboard stats, pipeline health, recent videos
  ProjectSettings.svelte              #   Edit name/description/status, delete (admin only)
  ProjectMembers.svelte               #   Member table, add-by-email, role management
  ProjectGuidelines.svelte            #   Markdown editor with preview, sanitized rendering

# Timeline viewer (Phase 3+) — route: /videos/[id]/timeline
apps/web/src/lib/components/viewer/   # Timeline viewer components
  AnnotationViewer.svelte             #   Root: state init, track layout, keyboard/wheel handlers
  data-loader.ts                      #   Extracted data loading (S3 results, annotation sets, polling)
  context.ts                          #   Five Symbol-keyed contexts (timeline, annotation-data, session, editor, task-mode)
  state/                              #   Svelte 5 rune state classes (timeline, annotation-data, session, editor, history, autosave, task-mode)
  editing/                            #   Pure functions: drag-resize (incl. move), operations, time-validation
  tracks/                             #   CanvasTrack + draw-functions.ts, DOMTrack, EditableDOMTrack, TrackLabel, TrackContent
  utils/                              #   Binary search (accessor overloads), group-words (transcription LOD), caches, focus-trap, push-undo
  components/                         #   Editing UI (CreateAnnotationBar, dialogs, ContextMenu (unwired), SaveIndicator, DraftRecoveryBanner), TaskPanel, MeshOverlay
  mesh-overlay.ts                     #   Face-mesh overlay geometry helpers
  viewer-palette.ts                   #   Theme-aware ViewerPalette for canvas draw functions
  viewer.css                          #   Dark/light theme variables + block color schemes + focus-visible

# Shared packages
packages/db/src/schema.ts             # Full Drizzle schema (all tables)
packages/shared/src/annotation-types.ts # Annotation data shapes
packages/shared/src/pipeline-types.ts   # Pipeline enums + status types + HUMAN_GATES
packages/shared/src/command-types.ts    # AnnotationCommand/Target/CommandResult types (not yet wired up, see ai-first.md)

# ML Pipeline
workers/ml-pipeline/modal_app.py       # Modal endpoints (all 8 stages)
workers/ml-pipeline/stages/            # Python stage implementations
workers/ml-pipeline/PIPELINE.md        # Per-stage model/architecture reference + improvement guide
```

## Schema Overview

All tables defined in `packages/db/src/schema.ts`:

- **profiles** — user identity + email (references Supabase auth.users)
- **projects** — name, description, status (active/paused/completed/archived), guidelines (markdown), timestamps
- **project_members** — role-based access (admin/supervisor/annotator), composite PK
- **videos** — uploaded video metadata + S3 key + processing status
- **processing_jobs** — ML pipeline stage tracking (one job per stage per video)
- **annotation_sets** — versioned annotation data (JSONB), partial unique index for current version
- **annotation_edits** — edit audit log
- **tasks** — human annotation task assignments + workflow
- **annotator_metrics** — QC metrics (future phases)

## Conventions

- **Refactor freely.** This is a greenfield project with no external consumers. There are zero backwards compatibility constraints. If you see a better name, structure, API shape, or design — change it now, don't preserve the old way. Rename, reorganize files, change interfaces, flatten abstractions, merge modules. When you make structural changes, briefly note what changed and why. The cost of a bad refactor is near zero; the cost of accumulated cruft is high.
- Svelte 5 runes (`$state`, `$derived`, `$effect`) — no legacy stores
- Server-only code in `$lib/server/` (SvelteKit enforces this)
- tRPC procedures use `protectedProcedure` (requires auth) by default
- Annotation JSONB shapes defined in `@annotation/shared`, mirrored in Drizzle schema JSONB columns
- S3 keys: `videos/{project_id}/{video_id}/{filename}` (uploads), `results/{video_id}/{stage}.json` (outputs)
- All times in seconds (float), time ranges half-open `[start, end)`

- Typography: Inter Variable (`@fontsource-variable/inter`) self-hosted. See `.claude/rules/style-guide.md` for type scale and usage rules.

Detailed conventions by domain in `.claude/rules/` — automatically loaded when working on matching paths.

## Common Commands (Modal)

```bash
cd workers/ml-pipeline
modal deploy modal_app.py          # Deploy all pipeline endpoints
modal serve modal_app.py           # Hot-reload dev server
```

## Environment Variables

See `.env.example` for required vars. Key groups:
- `SUPABASE_*` — Supabase project URL + keys
- `S3_*` / `AWS_*` — S3 bucket config (bucket: `sidechain-annotation-dev`, region: `us-west-2`)
- `MODAL_BASE_URL` — Base URL for Modal endpoints (subdomain-per-function format)
- `ANTHROPIC_API_KEY` — For intent classification stage
- `HF_TOKEN` — HuggingFace token for pyannote model access
- `DATABASE_URL` — Direct Postgres connection (Drizzle migrations and app queries)
- `PROCESSING_CALLBACK_SECRET` — Shared secret validating Modal's callback to `/api/processing/callback`
- `PUBLIC_APP_URL` — Base URL used to build the pipeline callback URL

## Pipeline Stages

Defined in `@annotation/shared`: `vad`, `waveform`, `transcription`, `facial_tracking`, `mouth_energy`, `diarization`, `state_annotation`, `intent_classification`

| Stage | Status | Model/Approach | GPU |
|-------|--------|---------------|-----|
| vad | Working | Silero VAD v5 (ffmpeg + soundfile audio loading) | No |
| waveform | Working | ffmpeg audio extraction + numpy peak computation (200 peaks/sec) | No |
| transcription | Working | WhisperX: faster-whisper large-v3-turbo + wav2vec2 alignment (+ optional pyannote speaker assignment when `HF_TOKEN` set) | A10G |
| facial_tracking | Working | MediaPipe FaceLandmarker task API + Depth Anything V2 keyframe depth (mesh overlay) | T4 |
| mouth_energy | Working | Weighted blend shape energy (10Hz) | No |
| diarization | In Development | pyannote/speaker-diarization-3.1 pipeline (`token=` auth fixed; still gated pending validation) | A10G |
| state_annotation | In Development | Rule-based (depends on diarization) | No |
| intent_classification | In Development | Claude API (depends on state_annotation, transcription, vad) | No |

DAG orchestration: `apps/web/src/lib/server/pipeline/{dag,trigger}.ts`
- Root stages (vad, waveform, transcription, facial_tracking) fire in parallel
- `triggerReadyStages()` auto-cascades dependents after each completion
- `IN_DEVELOPMENT_STAGES` set in dag.ts gates incomplete stages
- `HUMAN_GATES` (in `@annotation/shared`) blocks downstream stages until verify tasks are approved

## Authorization

**There are no RLS policies in this repo.** No migration contains `CREATE POLICY`. The app also queries Postgres directly through Drizzle (`DATABASE_URL`), which bypasses RLS anyway. Authorization is enforced in tRPC handlers instead, using project-membership and role checks. Reuse `requireMembership(db, projectId, userId, requiredRoles?)` from `routers/projects.ts`.
- **Annotators**: assigned videos/tasks within project membership
- **Supervisors**: read/update within project scope
- **Admins**: full access

## Rules (`.claude/rules/`)

Path-scoped rules auto-load when working on matching files:

| Rule | Scope | Content |
|------|-------|---------|
| `data-contracts.md` | All files | Time conventions, type shapes, enums, S3 keys, coverage rules |
| `svelte5.md` | `*.svelte`, `*.svelte.ts` | Rune syntax, class-based state, context pattern, common mistakes |
| `viewer.md` | `viewer/**` | Five-context system, timeline math, track types, viewport culling, mesh overlay |
| `editing.md` | `viewer/**` | Phase 4 editor state, drag-resize, operations, auto-save, task lifecycle |
| `trpc.md` | `trpc/**` | Router registration, Drizzle patterns, error handling |
| `pipeline.md` | `pipeline/**`, `workers/**` | DAG structure, trigger pattern, human gates, Modal conventions |
| `testing.md` | `*.test.ts` | Vitest setup, coverage table, remaining test priorities |
| `performance.md` | `viewer/**` | 60fps drag budget, viewport culling mandate, no-DnD-library rule |
| `ai-first.md` | `viewer/**`, `trpc/**`, `shared/**` | Target command-layer design (types only today), semantic targeting, agent API checklist |
| `style-guide.md` | `*.svelte`, `*.css`, `viewer/**` | Typography (Inter), type scale, color system, viewer density tokens |
| `docs.md` | `plans/**`, `reference/**` | Doc lifecycle, naming, INDEX.md maintenance, size limits, archive/split rules |

## Reference Docs

- **`plans/INDEX.md`** — Agent navigation hub. Start here to find any doc.
- `reference/` — Stable technical docs (setup, system flow, infrastructure, algorithm specs in 02a–02d)
- `spike/` — Phase 0 prototype (standalone HTML, not part of monorepo build)
- `plans/archive/` — Completed phase plans (Phases 0-4)
- `plans/archive/phase-0-reference/` — Superseded Phase 0 reference docs (01, 03–06), frozen
