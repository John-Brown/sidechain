# Annotation Platform

Video annotation pipeline: upload → ML processing → AI annotation → human validation → quality control.

## Architecture

**Monorepo** (pnpm workspaces + turborepo):

| Package | Purpose |
|---------|---------|
| `apps/web` | SvelteKit app (Svelte 5, Tailwind 4, shadcn-svelte) |
| `packages/shared` | TypeScript types (zero runtime deps) |
| `packages/db` | Drizzle ORM schema + migrations (postgres-js driver) |
| `workers/ml-pipeline` | Python Modal functions (uv-managed, independent of TS monorepo) |

## Tech Stack

- **Frontend**: SvelteKit, Svelte 5 (runes), Tailwind CSS 4, shadcn-svelte v2, bits-ui
- **API**: tRPC v11 (server + client, superjson transformer)
- **Auth**: Supabase SSR (@supabase/ssr)
- **Database**: PostgreSQL via Supabase, Drizzle ORM
- **Storage**: S3 (multipart upload, presigned URLs, @aws-sdk/client-s3)
- **ML Pipeline**: Modal (Python, Silero VAD, torch/torchaudio)
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
apps/web/src/hooks.server.ts           # Supabase auth middleware
apps/web/src/lib/server/supabase.ts    # Server Supabase client
apps/web/src/lib/server/trpc/         # tRPC router, context, procedures
apps/web/src/lib/server/s3.ts         # S3 presigned URL helpers
apps/web/src/lib/trpc.ts              # Browser tRPC client
apps/web/src/lib/supabase.ts          # Browser Supabase client
packages/db/src/schema.ts             # Full Drizzle schema (all tables)
packages/shared/src/annotation-types.ts # Annotation data shapes
packages/shared/src/pipeline-types.ts   # Pipeline enums + status types
workers/ml-pipeline/modal_app.py       # Modal VAD endpoint
workers/ml-pipeline/stages/vad.py      # Silero VAD processing logic
```

## Schema Overview

All tables defined in `packages/db/src/schema.ts`:

- **profiles** — user identity (references Supabase auth.users)
- **projects**, **project_members** — organization/access
- **videos** — uploaded video metadata + S3 key + processing status
- **processing_jobs** — ML pipeline stage tracking (one job per stage per video)
- **annotation_sets** — versioned annotation data (JSONB), partial unique index for current version
- **annotation_edits** — edit audit log
- **tasks** — human annotation task assignments + workflow
- **annotator_metrics** — QC metrics (future phases)

## Conventions

- Svelte 5 runes (`$state`, `$derived`, `$effect`) — no legacy stores
- Server-only code in `$lib/server/` (SvelteKit enforces this)
- tRPC procedures use `protectedProcedure` (requires auth) by default
- Annotation JSONB shapes defined in `@annotation/shared`, mirrored in Drizzle schema JSONB columns
- S3 keys follow: `videos/{project_id}/{video_id}/{filename}` for uploads, `results/{video_id}/{stage}.json` for outputs
- Processing callback: Modal POSTs to `/api/processing/callback` on completion

## Environment Variables

See `.env.example` for required vars. Key groups:
- `SUPABASE_*` — Supabase project URL + keys
- `S3_*` / `AWS_*` — S3 bucket config
- `MODAL_*` — Modal API tokens
- `DATABASE_URL` — Direct Postgres connection (for Drizzle migrations)

## Pipeline Stages

Defined in `@annotation/shared`: `vad`, `transcription`, `facial_tracking`, `mouth_energy`, `diarization`, `state_annotation`, `intent_classification`

Phase 1 implements VAD only. Later phases add remaining stages.

## RLS Policies

Row-level security enforced via Supabase:
- **Annotators**: See assigned videos/tasks within project membership
- **Supervisors**: Read/update within project scope
- **Admins**: Full access

## Reference Docs

- `plans/` — Architecture decisions and phase plans
- `reference/` — Algorithm specs, data flow, deployment guidance
- `spike/` — Phase 0 prototype (standalone HTML, not part of monorepo build)
