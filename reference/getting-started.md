# Getting Started with Sidechain

Developer setup guide for the Sidechain annotation platform.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | 22+ | Runtime |
| [pnpm](https://pnpm.io/) | 9.15+ | Package manager (corepack or standalone) |
| [Python](https://www.python.org/) | 3.11+ | ML pipeline only |
| [uv](https://docs.astral.sh/uv/) | Latest | Python package manager (ML pipeline only) |
| [Modal](https://modal.com/) | Latest | ML pipeline deployment (optional) |

Enable corepack for pnpm if you haven't:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

## Clone and Install

```bash
git clone <repo-url> annotation
cd annotation
pnpm install
```

This installs all workspace packages: `apps/web`, `packages/db`, `packages/shared`.

## Environment Variables

Create `apps/web/.env` with the following:

```bash
# Supabase (required)
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Database (required for migrations)
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# S3 storage (required for video upload + pipeline results)
S3_BUCKET=sidechain-annotation-dev
S3_REGION=us-west-2
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
# S3_ENDPOINT=http://localhost:9000  # Uncomment for local S3 (MinIO)

# Modal ML pipeline (optional — only needed to trigger processing)
# Stage URLs are built as ${MODAL_BASE_URL}-<function>.modal.run
MODAL_BASE_URL=https://your-modal-workspace--annotation-pipeline

# Pipeline callback (optional — for async job completion)
PUBLIC_APP_URL=http://localhost:5173
PROCESSING_CALLBACK_SECRET=your-secret

# AI stages (optional — only needed for intent classification)
ANTHROPIC_API_KEY=sk-ant-...
HF_TOKEN=hf_...
```

The `PUBLIC_` prefix exposes variables to the browser. Everything else is server-only.

## Database Setup

Run Drizzle migrations against your Supabase Postgres instance:

```bash
source apps/web/.env && DATABASE_URL="$DATABASE_URL" pnpm --filter db migrate
```

To inspect the schema visually:

```bash
source apps/web/.env && DATABASE_URL="$DATABASE_URL" pnpm --filter db studio
```

To generate new migration SQL after schema changes:

```bash
source apps/web/.env && DATABASE_URL="$DATABASE_URL" pnpm --filter db generate
```

## Run the Dev Server

```bash
# All packages (web + db + shared in watch mode)
pnpm dev

# Or just the web app
pnpm --filter web dev
```

The app runs at `http://localhost:5173`.

## Build

```bash
pnpm build              # Build all packages (turborepo)
pnpm --filter web build # Build web app only
pnpm --filter web check # Svelte type checking
```

## Run Tests

```bash
pnpm --filter web test        # Run all tests once
pnpm --filter web test:watch  # Watch mode
```

Tests use Vitest. The suite covers state classes, editing operations, binary search, timeline math, and data integrity.

## ML Pipeline (Optional)

The ML pipeline runs on [Modal](https://modal.com/) and is independent of the TypeScript monorepo.

```bash
cd workers/ml-pipeline

# Install Python deps
uv sync

# Hot-reload dev server (runs functions locally, proxied through Modal)
modal serve modal_app.py

# Deploy to Modal cloud
modal deploy modal_app.py
```

Pipeline stages (VAD, transcription, facial tracking, etc.) are triggered from the web app when a video is uploaded. See [PIPELINE.md](../workers/ml-pipeline/PIPELINE.md) for per-stage details and [system-flow.md](system-flow.md) for the end-to-end flow.

### Modal Environment

Modal functions read named secrets configured in the Modal dashboard (see `modal_app.py`):

- `aws-credentials`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `S3_BUCKET` (same bucket as the web app)
- `huggingface`: `HF_TOKEN` (pyannote diarization; also attached to transcription)
- `anthropic`: `ANTHROPIC_API_KEY` (intent classification)

## Project Structure

```
annotation/
├── apps/web/            SvelteKit app (frontend + tRPC API)
├── packages/db/         Drizzle ORM schema + migrations
├── packages/shared/     TypeScript types (zero runtime deps)
├── workers/ml-pipeline/ Python Modal functions (uv-managed)
├── plans/               Active plans + devlog
├── reference/           Stable technical docs (you are here)
└── spike/               Phase 0 prototype (archived)
```

See the Architecture section of [CLAUDE.md](../CLAUDE.md) and [system-flow.md](system-flow.md) for full architecture details.

## Common Tasks

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Dev server | `pnpm dev` |
| Build all | `pnpm build` |
| Type check | `pnpm --filter web check` |
| Run tests | `pnpm --filter web test` |
| Generate migration | `source apps/web/.env && DATABASE_URL="$DATABASE_URL" pnpm --filter db generate` |
| Run migrations | `source apps/web/.env && DATABASE_URL="$DATABASE_URL" pnpm --filter db migrate` |
| Drizzle Studio | `source apps/web/.env && DATABASE_URL="$DATABASE_URL" pnpm --filter db studio` |
| Deploy pipeline | `cd workers/ml-pipeline && modal deploy modal_app.py` |

## Troubleshooting

**`adapter-auto` warning during build** — Expected until a production adapter is configured. No impact on dev.

**`DATABASE_URL` not found during migration** — The db package doesn't read `.env` files. Source it explicitly: `source apps/web/.env && DATABASE_URL="$DATABASE_URL" pnpm --filter db migrate`.

**S3 CORS errors on upload** — Your S3 bucket needs CORS configured to allow requests from `http://localhost:5173`. See [local-to-aws-migration.md](local-to-aws-migration.md).

**Pipeline results not appearing** — Check that `MODAL_BASE_URL` is set and the Modal functions are deployed. Pipeline status is tracked per-video in the processing_jobs table.

## Next Steps

- [system-flow.md](system-flow.md) — Roles, stage DAG, human gates, data streams
- [PIPELINE.md](../workers/ml-pipeline/PIPELINE.md) — Per-stage Modal pipeline reference
- [02a-algorithm-reference-vad-transcription-face.md](02a-algorithm-reference-vad-transcription-face.md) — ML algorithm specs per stage (4 parts; Phase 0 implementation details)
- [cloud-infrastructure.md](cloud-infrastructure.md) — Supabase, S3, Modal, and cost notes
