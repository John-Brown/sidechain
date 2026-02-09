# Documentation Index

Agent navigation hub — find the right doc in one hop.

## Active Plans

| File | Summary |
|------|---------|
| [phase-4-editing-task-mode.md](phase-4-editing-task-mode.md) | Annotation editing + task mode (human-in-the-loop) — **in progress** |
| [project-management-future-tiers.md](project-management-future-tiers.md) | Tier 2/3 project features: pipeline config, QC, invitations, taxonomy |
| [DEVLOG.md](DEVLOG.md) | Append-only development log (newest first) |

## Analyses

| File | Summary |
|------|---------|
| [viewer-code-review.md](viewer-code-review.md) | Code review of timeline viewer architecture |
| [timestamp-alignment-analysis.md](timestamp-alignment-analysis.md) | Root cause analysis of transcription timestamp offset |

## Reference (`reference/`)

Stable technical docs — algorithm specs, data flow, deployment.

| File | Summary |
|------|---------|
| [getting-started.md](../reference/getting-started.md) | Developer setup guide (Sidechain web app) |
| [01-system-overview.md](../reference/01-system-overview.md) | High-level system architecture |
| [02-algorithm-reference.md](../reference/02-algorithm-reference.md) | ML algorithm specs per pipeline stage |
| [03-data-flow.md](../reference/03-data-flow.md) | Data flow through the pipeline |
| [04-quick-start.md](../reference/04-quick-start.md) | Developer setup guide |
| [05-cloud-deployment-guidance.md](../reference/05-cloud-deployment-guidance.md) | Cloud deployment patterns |
| [06-typescript-cloud-port.md](../reference/06-typescript-cloud-port.md) | TypeScript cloud port notes |
| [07-facial-tracking-reference.md](../reference/07-facial-tracking-reference.md) | MediaPipe facial tracking reference |
| [system-flow.md](../reference/system-flow.md) | Pipeline flow diagram (with assets) |
| [cloud-infrastructure.md](../reference/cloud-infrastructure.md) | Infrastructure documentation |
| [local-to-aws-migration.md](../reference/local-to-aws-migration.md) | S3 migration runbook (local → AWS) |

## Completed Phases (`plans/archive/`)

| File | Phase |
|------|-------|
| [phase-0-original-architecture.md](archive/phase-0-original-architecture.md) | Phase 0 — spike/prototype architecture |
| [phase-1-plan.md](archive/phase-1-plan.md) | Phase 1 — monorepo skeleton + schema + VAD |
| [phase-2-pipeline-frontend.md](archive/phase-2-pipeline-frontend.md) | Phase 2 — all 7 stages + DAG + frontend |
| [phase3-qa-checklist.md](archive/phase3-qa-checklist.md) | Phase 3 — QA checklist |
| [v1-qa.md](archive/v1-qa.md) | V1 QA checklist |

## Conventions (`.claude/rules/`)

Auto-loaded by path scope. See CLAUDE.md Rules section for the full table.

| Rule | When |
|------|------|
| `docs.md` | Editing docs in `plans/`, `reference/` |
| `editing.md` | Viewer editing code |
| `viewer.md` | Viewer components |
| `pipeline.md` | Pipeline/Modal code |
| `testing.md` | Test files |
