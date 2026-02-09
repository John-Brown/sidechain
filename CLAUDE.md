# Sidechain

Video annotation pipeline: upload → ML processing → AI annotation → human validation → quality control.

## Project Status

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Spike/prototype | Complete (`spike/`) |
| 1 | Monorepo skeleton + schema + VAD pipeline | Complete |
| 2 | All 7 pipeline stages + DAG orchestration + frontend | Complete (4/7 stages verified, 3 gated as in-dev) |
| 3 | Read-only timeline viewer (multi-track timeline, Canvas + DOM tracks, viewport culling) | Complete |
| 3.5 | Project management (detail page, members, guidelines, dashboard) | Complete |
| 4 | Annotation editing + task mode (human-in-the-loop) | **In progress** → `plans/phase-4-editing-task-mode.md` |
| 4.1 | User labels track (freeform text annotations, drag-move, view persistence) | Complete |

## Architecture

**Monorepo** (pnpm workspaces + turborepo):

| Package | Purpose |
|---------|---------|
| `apps/web` | SvelteKit app (Svelte 5, Tailwind 4, shadcn-svelte) |
| `packages/shared` | TypeScript types (zero runtime deps) |
| `packages/db` | Drizzle ORM schema + migrations (postgres-js driver) |
| `workers/ml-pipeline` | Python Modal functions (uv-managed, independent of TS monorepo) |

## Tech Stack

- **Frontend**: SvelteKit, Svelte 5 (runes), Tailwind CSS 4, shadcn-svelte v2, bits-ui, Inter Variable typeface
- **API**: tRPC v11 (server + client, superjson transformer)
- **Auth**: Supabase SSR (@supabase/ssr)
- **Database**: PostgreSQL via Supabase, Drizzle ORM
- **Storage**: S3 (multipart upload, presigned URLs, @aws-sdk/client-s3)
- **ML Pipeline**: Modal (Python, Silero VAD, faster-whisper, MediaPipe, pyannote)
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
```

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
  context.ts                          #   Three Symbol-keyed contexts (timeline, annotations, session)
  state/                              #   Svelte 5 rune state classes (timeline, annotation-data, session, editor, autosave)
  editing/                            #   Pure functions: drag-resize (incl. move), operations, time-validation
  tracks/                             #   CanvasTrack (VAD/energy), DOMTrack, EditableDOMTrack (drag-resize + move)
  components/                         #   CreateAnnotationBar, LabelTextDialog, ClassifyDialog, KeyboardShortcutsHelp, SaveIndicator
  viewer.css                          #   Dark theme variables + block color schemes

# Shared packages
packages/db/src/schema.ts             # Full Drizzle schema (all tables)
packages/shared/src/annotation-types.ts # Annotation data shapes
packages/shared/src/pipeline-types.ts   # Pipeline enums + status types

# ML Pipeline
workers/ml-pipeline/modal_app.py       # Modal endpoints (all 7 stages)
workers/ml-pipeline/stages/            # Python stage implementations
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
- `DATABASE_URL` — Direct Postgres connection (for Drizzle migrations)

## Pipeline Stages

Defined in `@annotation/shared`: `vad`, `transcription`, `facial_tracking`, `mouth_energy`, `diarization`, `state_annotation`, `intent_classification`

| Stage | Status | Model/Approach | GPU |
|-------|--------|---------------|-----|
| vad | Working | Silero VAD v5 (ffmpeg + soundfile audio loading) | No |
| transcription | Working | faster-whisper large-v3 | A10G |
| facial_tracking | Working | MediaPipe FaceLandmarker task API | No |
| mouth_energy | Working | Weighted blend shape energy (10Hz) | No |
| diarization | In Development | pyannote.audio 3.1 (blocked: `use_auth_token` API change) | T4 |
| state_annotation | In Development | Rule-based (depends on diarization) | No |
| intent_classification | In Development | Claude API (depends on state_annotation) | No |

DAG orchestration: `apps/web/src/lib/server/pipeline/{dag,trigger}.ts`
- Root stages (vad, transcription, facial_tracking) fire in parallel
- `triggerReadyStages()` auto-cascades dependents after each completion
- `IN_DEVELOPMENT_STAGES` set in dag.ts gates incomplete stages

## RLS Policies

Row-level security enforced via Supabase:
- **Annotators**: See assigned videos/tasks within project membership
- **Supervisors**: Read/update within project scope
- **Admins**: Full access

## Rules (`.claude/rules/`)

Path-scoped rules auto-load when working on matching files:

| Rule | Scope | Content |
|------|-------|---------|
| `data-contracts.md` | All files | Time conventions, type shapes, enums, S3 keys, coverage rules |
| `svelte5.md` | `*.svelte`, `*.svelte.ts` | Rune syntax, class-based state, context pattern, common mistakes |
| `viewer.md` | `viewer/**` | Three-context system, timeline math, track types, viewport culling |
| `editing.md` | `viewer/**` | Phase 4 editor state, drag-resize, operations, auto-save, task lifecycle |
| `trpc.md` | `trpc/**` | Router registration, Drizzle patterns, error handling |
| `pipeline.md` | `pipeline/**`, `workers/**` | DAG structure, trigger pattern, human gates, Modal conventions |
| `testing.md` | `*.test.ts` | Vitest setup, Phase 4 test priorities |
| `performance.md` | `viewer/**` | 60fps drag budget, viewport culling mandate, no-DnD-library rule |
| `ai-first.md` | `viewer/**`, `trpc/**`, `shared/**` | Command layer, semantic targeting, agent API, NL-readiness checklist |
| `style-guide.md` | `*.svelte`, `*.css`, `viewer/**` | Typography (Inter), type scale, color system, viewer density tokens |

## Reference Docs

- `plans/` — Architecture decisions and phase plans (current: `phase-4-editing-task-mode.md`)
- `plans/project-management-future-tiers.md` — Tier 2/3 project features (pipeline config, QC, invitations, taxonomy)
- `reference/` — Algorithm specs, data flow, deployment guidance
- `spike/` — Phase 0 prototype (standalone HTML, not part of monorepo build)
