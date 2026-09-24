# Documentation Index

Agent navigation hub — find the right doc in one hop.

## Active Plans

| File | Summary |
|------|---------|
| [project-management-future-tiers.md](project-management-future-tiers.md) | Tier 2/3 project features: pipeline config, QC, invitations, taxonomy |
| [DEVLOG.md](DEVLOG.md) | Append-only development log (newest first) |

## Analyses

| File | Summary |
|------|---------|
| [timestamp-alignment-analysis.md](timestamp-alignment-analysis.md) | Root cause analysis of transcription timestamp offset |

## Reference (`reference/`)

Stable technical docs: setup, system flow, infrastructure, algorithm specs.

> Start with `getting-started.md` (setup), `system-flow.md` (roles, DAG, gates) and `workers/ml-pipeline/PIPELINE.md` (current stage internals). The 02a–02d algorithm parts and 07 keep valid algorithm/design background but carry a status banner: their implementation details (`src/processing/*.py`, FaceKitRunner, Swift app) are from the Phase 0 spike.

| File | Summary |
|------|---------|
| [getting-started.md](../reference/getting-started.md) | Developer setup guide (Sidechain web app + Modal pipeline) |
| [system-flow.md](../reference/system-flow.md) | End-to-end flow: roles, stage DAG, human gates, data streams (images in `system-flow-assets/`) |
| [PIPELINE.md](../workers/ml-pipeline/PIPELINE.md) | Per-stage Modal pipeline reference: models, GPUs, improvement roadmap |
| [cloud-infrastructure.md](../reference/cloud-infrastructure.md) | Supabase, S3, Modal, Anthropic, HuggingFace: roles, costs, alternatives |
| [local-to-aws-migration.md](../reference/local-to-aws-migration.md) | S3 migration runbook (local → AWS) |
| [02a-algorithm-reference-vad-transcription-face.md](../reference/02a-algorithm-reference-vad-transcription-face.md) | Algorithm specs part A: VAD, transcription, facial tracking (Phase 0 implementation details) |
| [02b-algorithm-reference-mouth-diarization-states.md](../reference/02b-algorithm-reference-mouth-diarization-states.md) | Algorithm specs part B: mouth energy, diarization, state annotation |
| [02c-algorithm-reference-intents-summary.md](../reference/02c-algorithm-reference-intents-summary.md) | Algorithm specs part C: intent classification, dependency graph, performance table |
| [02d-algorithm-reference-phase0-extras.md](../reference/02d-algorithm-reference-phase0-extras.md) | Algorithm specs part D: per-speaker stereo transcription + analyst report (Phase 0 only, not in monorepo) |
| [07-facial-tracking-reference.md](../reference/07-facial-tracking-reference.md) | FaceKitRunner outputs, mouth-energy critical path, MediaPipe replacement analysis (MediaPipe shipped) |
| [talkvid-dataset.md](../reference/talkvid-dataset.md) | TalkVid dataset format, quality metrics, download instructions |

## Completed Phases (`plans/archive/`)

| File | Phase |
|------|-------|
| [phase-0-original-architecture.md](archive/phase-0-original-architecture.md) | Phase 0 — spike/prototype architecture |
| [phase-1-plan.md](archive/phase-1-plan.md) | Phase 1 — monorepo skeleton + schema + VAD |
| [phase-2-pipeline-frontend.md](archive/phase-2-pipeline-frontend.md) | Phase 2 — all 7 stages + DAG + frontend |
| [phase3-qa-checklist.md](archive/phase3-qa-checklist.md) | Phase 3 — QA checklist |
| [v1-qa.md](archive/v1-qa.md) | V1 QA checklist |
| [phase-4-editing-task-mode.md](archive/phase-4-editing-task-mode.md) | Phase 4 — annotation editing + task mode (infra complete; only user labels editable in viewer; state/intent/backchannel tracks, command-executor layer and router tests deferred) |
| [viewer-code-review.md](archive/viewer-code-review.md) | Phase 4.2 — timeline viewer code review (all 20 fixes shipped, f1740ef) |

## Archived Reference (`plans/archive/phase-0-reference/`)

Superseded reference docs describing the Phase 0 spike. Frozen snapshots; read for history only.

| File | Summary |
|------|---------|
| [01-system-overview.md](archive/phase-0-reference/01-system-overview.md) | Phase 0 architecture: Python `src/processing/`, Swift app, analyst report, LLM annotation |
| [03-data-flow.md](archive/phase-0-reference/03-data-flow.md) | Phase 0 data flow, local JSON output layout, CLI patterns, `annotation_saves.json` log |
| [04-quick-start.md](archive/phase-0-reference/04-quick-start.md) | Phase 0 setup (pip/venv, FaceKitRunner, Swift app); superseded by getting-started.md |
| [05-cloud-deployment-guidance.md](archive/phase-0-reference/05-cloud-deployment-guidance.md) | Pre-migration cloud deployment + language options for the spike |
| [06-typescript-cloud-port.md](archive/phase-0-reference/06-typescript-cloud-port.md) | Pre-migration TypeScript port viability + cost analysis (Feb 2026) |

## Conventions (`.claude/rules/`)

Auto-loaded by path scope. See CLAUDE.md Rules section for the full table.

| Rule | When |
|------|------|
| `docs.md` | Editing docs in `plans/`, `reference/` |
| `editing.md` | Viewer editing code |
| `viewer.md` | Viewer components |
| `pipeline.md` | Pipeline/Modal code |
| `testing.md` | Test files |
