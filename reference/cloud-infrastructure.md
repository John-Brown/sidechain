# Cloud Infrastructure

This document covers the cloud services Sidechain uses, why they were chosen, and alternatives worth considering as the project scales.

---

## Services Overview

| Service | Role | Cost Model | Status |
|---------|------|-----------|--------|
| **Supabase** | Auth + PostgreSQL | Free tier → usage-based | Production |
| **AWS S3** | Video + result storage | Storage + transfer | Production |
| **Modal** | ML pipeline compute | Per-second GPU/CPU | Production |
| **Anthropic API** | Intent classification | Per-token | In development |
| **HuggingFace Hub** | Model weights (pyannote) | Free (gated models need token) | In development |

---

## Supabase

### What we use it for

- **Authentication**: SSR-based auth via `@supabase/ssr`. Handles signup/login, session cookies, OAuth-ready. The server hook (`hooks.server.ts`) calls `getUser()` for server-side verification, then `getSession()` for session data.
- **PostgreSQL database**: All application state — users, projects, videos, processing jobs, annotation sets (versioned JSONB), tasks, audit logs. Accessed via Drizzle ORM with `postgres-js` driver, not the Supabase client SDK.
- **Local development**: `supabase start` gives you Postgres + Auth + a local S3-compatible endpoint on `localhost:54321`, so the full stack runs offline.

### Why Supabase

- **Single platform for auth + DB + local dev**. Eliminates multi-vendor configuration during prototyping. One `supabase start` replaces setting up Postgres, an auth provider, and a local object store separately.
- **SSR auth is well-supported**. The `@supabase/ssr` package handles cookie-based sessions correctly with SvelteKit's server hooks, avoiding the common pitfalls of JWT-in-localStorage approaches.
- **Postgres is the real product**. We use Drizzle ORM for all data access — we're not locked into the Supabase client SDK for queries. The Supabase dependency is effectively just auth + managed Postgres hosting.

### What we don't use

- Supabase Storage (we use real AWS S3 instead — Modal can't reach local Supabase)
- Supabase Realtime / Edge Functions / Vectors

### Alternatives

| Alternative | Trade-off |
|-------------|-----------|
| **Clerk / Auth0 / Lucia** | Auth-only. Would need separate Postgres hosting (Neon, Railway, RDS). More flexibility but more configuration. Clerk has excellent SvelteKit support. |
| **Neon + Clerk** | Serverless Postgres (branching, autoscale) + dedicated auth. Better for production scale, more operational overhead. |
| **Firebase** | Auth + Firestore. Different data model (document vs relational). Poor fit for the heavily relational annotation schema. |
| **Self-hosted Postgres + custom auth** | Maximum control. Significant ops burden for a small team. Not worth it until scale demands it. |

### Migration path

Supabase → Neon/RDS is straightforward since we use Drizzle ORM (just change `DATABASE_URL`). Auth migration is harder — would need to export users and switch session handling. Worth deferring until Supabase's free tier or performance limits become a real constraint.

---

## AWS S3

### What we use it for

- **Video uploads**: Browser → S3 via multipart presigned URLs (1-hour expiry). Avoids routing large files through the SvelteKit server.
- **Pipeline results**: Each ML stage writes a JSON file (e.g., `voice_activity.json`, `speech_transcription.json`) to S3. The viewer fetches these on demand.
- **Approved annotations**: Human-edited annotations get exported to S3 on task approval for downstream consumption.

### Configuration

- **Bucket**: `sidechain-annotation-dev` in `us-west-2`
- **SDK**: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (v3)
- **Key scheme**: `videos/{projectId}/{videoId}/{filename}` for uploads, `results/{videoId}/{stage}.json` for outputs

### Why S3

- **De facto standard**. Every tool in the pipeline (Modal, Python boto3, browser fetch) speaks S3 natively.
- **Presigned URLs decouple upload from server**. The browser uploads directly to S3; the server just issues the presigned URL. No bandwidth bottleneck.
- **Pipeline results are large blobs, not relational data**. Storing them in S3 (not DB JSONB) avoids database bloat and allows a browser-side caching layer (IndexedDB via `idb-keyval`).

### Alternatives

| Alternative | Trade-off |
|-------------|-----------|
| **Cloudflare R2** | S3-compatible, zero egress fees. Significant cost savings at scale. Drop-in replacement (change endpoint + credentials). Best alternative if egress costs grow. |
| **Supabase Storage** | Already in the stack. But Modal functions can't reach a local Supabase instance, and the API is less mature than S3 for multipart uploads. |
| **GCS (Google Cloud Storage)** | Comparable to S3. Different SDK, no real advantage unless already in GCP ecosystem. |
| **MinIO (self-hosted)** | S3-compatible, runs anywhere. Good for air-gapped or on-prem deployments. Operational overhead not justified currently. |

### Migration path

S3 → R2 is nearly zero-effort: same API, change the endpoint and credentials. Worth doing if egress costs become significant (R2 has zero egress fees).

---

## Modal

### What we use it for

- **Serverless ML inference**. 8 pipeline stages (including the `waveform` root stage), each as a `@modal.fastapi_endpoint`. Modal handles container orchestration, GPU provisioning, and cold-start management.
- **GPU workloads**: Transcription (faster-whisper on A10G), diarization (pyannote on A10G), facial tracking (MediaPipe + depth model on T4). Other stages run CPU-only.
- **Isolated environments**: Each stage has its own Docker image with pinned dependencies. No conflicts between e.g., MediaPipe and PyTorch versions.

### How it works

1. A tRPC mutation (`processing` router) triggers the root stages → HTTP POST to each Modal endpoint
2. Modal spins up a container with the right image/GPU
3. Stage runs synchronously: reads input from S3, processes, writes result to S3
4. Returns `StageResponse` with status + result key
5. Modal POSTs a callback to `/api/processing/callback`, which marks the job complete and triggers newly ready stages (DAG cascading)

### Stage resource profiles

| Stage | Image | GPU | Memory | Approx. cold start |
|-------|-------|-----|--------|-------------------|
| VAD | Silero VAD, ffmpeg, soundfile | None | 2 GB | ~10s |
| Waveform | ffmpeg, NumPy | None | 1 GB | ~5s |
| Transcription | faster-whisper, whisperx | A10G | 4 GB | ~30s (model load) |
| Facial tracking | MediaPipe, OpenCV, depth model | T4 | 8 GB | ~15s |
| Mouth energy | NumPy | None | 1 GB | ~5s |
| Diarization | pyannote.audio, speechbrain | A10G | 4 GB | ~30s |
| State annotation | Rule-based (NumPy) | None | 1 GB | ~5s |
| Intent classification | Anthropic SDK | None | 1 GB | ~5s |

### Why Modal

- **No infrastructure management**. No Kubernetes, no EC2 instances, no Docker registry. `modal deploy modal_app.py` and it's live.
- **Per-second GPU billing**. A10G time is expensive — paying only for active inference seconds (not idle instances) keeps costs proportional to usage.
- **Synchronous endpoints simplify orchestration**. The request blocks until processing completes and returns the result. No queue polling, no webhook infrastructure, no SQS/SNS.
- **Python-native**. ML engineers write normal Python functions with decorators. The deployment abstraction is minimal compared to Lambda/Cloud Functions.

### Alternatives

| Alternative | Trade-off |
|-------------|-----------|
| **Replicate** | Similar model — deploy models as API endpoints. Less control over custom pipeline logic. Better for single-model inference, worse for multi-stage DAGs. |
| **AWS Lambda + SageMaker** | Enterprise-grade. Lambda for CPU stages, SageMaker for GPU. Significantly more configuration (IAM, VPC, ECR, CloudWatch). Better for production at scale, worse for iteration speed. |
| **Google Cloud Run + Vertex AI** | GCP equivalent. Cloud Run for stateless CPU, Vertex for GPU inference. Same trade-off: more config, more control. |
| **BentoML / Ray Serve** | Self-hosted model serving. Maximum control over infrastructure and cost at scale. Requires managing a cluster (K8s or equivalent). |
| **RunPod / Banana / Beam** | GPU-focused serverless alternatives. Similar to Modal but smaller ecosystems. Worth evaluating if Modal pricing becomes a concern. |
| **Local GPU (own hardware)** | Zero cloud cost after hardware purchase. No auto-scaling, requires maintenance. Could supplement cloud for development/testing. |

### Migration path

Modal's lock-in is minimal — each stage is a standard Python function that reads/writes S3. Porting to Lambda or Cloud Run means rewriting the deployment wrapper (decorators → Dockerfile + deploy config), not the processing logic.

---

## Anthropic API (Claude)

### What we use it for

- **Intent classification stage**: Analyzes transcribed speech segments to classify conversational intents (6 types), intensity (3 levels), and valence (3 levels). Uses Claude Sonnet for semantic understanding that rule-based approaches can't match.

### Configuration

- **Model**: `claude-sonnet-5` (see `CLAUDE_MODEL` in `stages/intent_classification.py`)
- **SDK**: `anthropic` Python package (>=1.0), called from within a Modal function
- **Status**: In development (gated in `IN_DEVELOPMENT_STAGES`)

### Why Claude

- **Semantic classification needs language understanding**. Intent, intensity, and valence are inherently subjective labels that benefit from LLM reasoning over embedding-based classifiers.
- **Structured output**. Claude's tool-use / structured output capabilities map well to producing typed classification results.

### Alternatives

| Alternative | Trade-off |
|-------------|-----------|
| **OpenAI GPT-4o** | Comparable capability. Different API/SDK. No strong reason to prefer one over the other for this task. |
| **Fine-tuned classifier** | Much cheaper at scale (one-time training cost, fast inference). Requires labeled training data we don't have yet. Natural evolution once annotation volume grows. |
| **Open-source LLM (Llama, Mistral)** | Self-hosted via Modal GPU. Eliminates per-token cost. Higher operational complexity, potentially lower quality for nuanced classification. |

### Migration path

The intent classification stage is a single Python module (`stages/intent_classification.py`). Swapping the model provider means changing the API call, not the pipeline architecture.

---

## HuggingFace Hub

### What we use it for

- **Model weight downloads**: `pyannote/speaker-diarization-3.1` for diarization stage. Gated model requiring authentication.
- **Token**: `HF_TOKEN` environment variable passed to Modal via secrets

### Status

In development — diarization stage is blocked by a `use_auth_token` API deprecation in newer pyannote versions.

### Alternatives

Downloading model weights is standard practice. No realistic alternative to HuggingFace Hub for pyannote models specifically. Could pre-bake weights into the Modal image to avoid download on cold start.

---

## What's not chosen yet

### Deployment / Hosting

The SvelteKit app currently uses `@sveltejs/adapter-auto` with no deployment target configured. Options:

| Option | Fit | Notes |
|--------|-----|-------|
| **Vercel** | Good | Auto-detected by adapter-auto. Serverless functions for tRPC. Free tier generous. Edge functions for auth middleware. |
| **Cloudflare Pages** | Good | Fast edge network. Workers for server routes. Pairs well with R2 if we migrate from S3. |
| **Fly.io / Railway** | Good | Container-based. More control over runtime. Better for long-running server processes if needed. |
| **Self-hosted (Docker)** | Flexible | Full control. Requires VPS + ops. Makes sense if cost optimization or data sovereignty matters. |

### Monitoring / Observability

Not yet implemented. Will need:
- Error tracking (Sentry)
- Pipeline job monitoring (Modal has built-in dashboards, but custom alerting would help)
- Usage analytics (PostHog, Plausible)

### CDN / Media Delivery

Currently serving video via S3 presigned URLs directly. At scale, a CDN (CloudFront, Cloudflare) in front of S3 would reduce latency and egress costs.

---

## Cost profile (rough order of magnitude)

| Service | Free tier | Scaling driver | When it matters |
|---------|-----------|---------------|-----------------|
| Supabase | 500 MB DB, 50K auth users | DB size, API requests | ~1000+ videos with full annotation history |
| S3 | 5 GB storage, 20K GETs | Video storage + egress | ~100+ videos (especially with large files) |
| Modal | $30/mo credits | GPU seconds (A10G ~$0.76/hr) | Processing volume — each video costs ~$0.05-0.50 depending on length |
| Anthropic | Pay-per-token | Intent classification volume | Scales linearly with annotated segments |
| HuggingFace | Free (gated models) | N/A | N/A |

The biggest variable cost is Modal GPU time (transcription + diarization). For a team annotating dozens of videos per week, expect Modal costs in the $10-50/month range. S3 egress becomes relevant if videos are frequently re-watched or shared.

---

## Research Notes (Feb 2026)

Findings from evaluating the open decisions above. Sources: Perplexity search across vendor docs, benchmarks, and pricing pages.

### Deployment: Railway recommended

| Platform | SvelteKit SSR Perf | Free Tier | tRPC Cold Start | CPU Limits |
|----------|-------------------|-----------|-----------------|------------|
| **Vercel** | Baseline | 100GB bandwidth, 6K build mins | ~50ms (edge) | 50ms CPU (free) |
| **Cloudflare Pages** | ~same as Vercel | **Unlimited bandwidth** | **<5ms** (fastest) | **10ms CPU (free) — too tight for tRPC** |
| **Railway** | **3.6x faster than Vercel** | $5/mo base, pay-per-use | ~100-200ms (server) | **Unlimited** |

**Railway wins for this stack.** SvelteKit SSR benchmarks show Railway (Bun runtime) at 3.6x Vercel and 3.1x Cloudflare on throughput. More importantly: tRPC endpoints that call Supabase auth + S3 + Modal need real CPU time. Cloudflare's 10ms free CPU limit is instantly exceeded — you'd need the $5/mo paid Workers tier, at which point Railway's $5/mo with no CPU limits is cleaner. Vercel works but has a Next.js-biased DX and lower SvelteKit perf.

**When to reconsider**: If edge distribution matters (global team) or you go all-in on Cloudflare (Pages + R2 + CDN as a unified story).

### S3 → R2: Not yet, but trivially easy later

At 50-200 videos/month (~5-20GB egress), S3 egress costs **$0.45-$1.80/month**. Not worth optimizing.

R2 compatibility confirmed:
- Drop-in with `@aws-sdk/client-s3` — change endpoint to `https://<account>.r2.cloudflarestorage.com`
- Presigned URLs and multipart uploads both work identically
- R2 free tier: 10GB storage, 10M GETs, 1M writes/month
- Zero egress fees with no caveats at this scale (rate limits: 50 bucket ops/sec, 1 concurrent write/sec per object)
- Migration tool: Cloudflare "Super Slurper" copies from S3 directly, and **AWS waives egress for S3→R2 transfers**

**When to pull the trigger**: Egress > $10/mo (~500+ video views/month), or if adopting Cloudflare for hosting.

### Modal GPU pricing update

Modal no longer lists A10G. Current GPU options relevant to this project:

| GPU | $/hour | Notes |
|-----|--------|-------|
| T4 (16GB) | $0.59 | Budget option for diarization |
| **L4 (24GB)** | **$0.80** | Likely A10G replacement — use for transcription + diarization |
| A100 (40GB) | $2.10 | Overkill for current workloads |
| H100 (80GB) | $3.95 | Modal undercuts RunPod (~$9.98/hr) significantly |

CPU + memory billed separately: $0.047/core/hr, $0.008/GiB/hr.

Free tier unchanged: **$30/mo credits**, 100 containers, 10 GPU concurrency. Comfortably covers a small annotation project.

Lock-in assessment confirmed minimal — stages are standard Python functions reading/writing S3. Porting means rewriting Modal decorators into Dockerfiles, not rewriting logic.

**Action item**: Update `modal_app.py` GPU references from `A10G` to `L4` and verify performance parity.

### Supabase: Still the right choice

Free tier unchanged (500MB DB, 50K MAUs). Pro at $25/mo bumps to 8GB DB, 100K MAUs. No reported outages or breaking changes in 2026.

For a project using Supabase only for auth + Postgres (not Storage, Realtime, or Edge Functions), the main value is operational simplicity: `supabase start` for local dev, one vendor for auth + DB. The Drizzle ORM layer keeps the Postgres dependency fully portable (`DATABASE_URL` swap).

**Lock-in vector is auth, not the database.** Exporting users and switching session handling is real work. Postgres migrates trivially via Drizzle.

| Signal | Action |
|--------|--------|
| DB > 8GB or need branch-per-PR dev workflows | Evaluate **Neon** (serverless Postgres, instant branching) |
| Auth needs grow complex (SSO, org management) | Evaluate **Clerk** (best dedicated auth DX for SvelteKit) |
| Paying $25/mo but only using auth + 200MB database | Split to **Neon free + Auth.js** |

None of these apply currently. Revisit when scaling beyond a small team.

### Monitoring: Minimum viable stack

| Concern | Tool | Free Tier | Setup Effort |
|---------|------|-----------|-------------|
| **Error tracking** | Sentry | 5K errors/mo | `@sentry/sveltekit` — native OpenTelemetry since SvelteKit v2.31.0. ~30 min setup. |
| **Analytics** | Plausible (self-hosted) | Unlimited | Cookie-free, GDPR-clean. Lightweight script in `+layout.svelte`. |
| **Uptime** | UptimeRobot | 50 monitors | Ping `/health` endpoint. |
| **Pipeline jobs** | Modal dashboard (built-in) | Free | Already available, no setup. |

PostHog is the alternative to Plausible if funnels/session replay/A/B testing are needed — 1M events/mo free hosted, or unlimited self-hosted. For an annotation tool used by a small team, Plausible is sufficient.

SvelteKit's native OpenTelemetry support (v2.31.0+) is the foundation — enable it once and traces propagate through Sentry or any OTEL collector. Future-proofs for Grafana Cloud or SigNoz without re-instrumenting.

**Total cost: $0.** Implement Sentry first (highest signal-to-effort ratio), add analytics and uptime monitoring as needed.

### Decision summary

| Decision | Recommendation | Trigger to Revisit |
|----------|---------------|--------------------|
| Hosting | **Railway** ($5/mo, best SvelteKit perf, no CPU limits) | Need edge distribution or unified Cloudflare stack |
| Storage | **Stay on S3** | Egress > $10/mo or Cloudflare hosting adoption |
| ML compute | **Stay on Modal** (update GPU refs A10G → L4) | Volume exceeds $30/mo free credits |
| Auth + DB | **Stay on Supabase** | DB > 8GB, auth complexity, or cost optimization pressure |
| Monitoring | **Sentry + Plausible + UptimeRobot + Modal dashboard** | Need deeper product analytics (→ PostHog) |
