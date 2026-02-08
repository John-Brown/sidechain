---
paths:
  - "apps/web/src/lib/server/pipeline/**"
  - "workers/ml-pipeline/**"
---

# Pipeline & DAG

## DAG Structure (dag.ts)

```
vad ──────────────────────────────────┐
transcription ─────────────────────────┤
facial_tracking → mouth_energy ────────┤
                                       ├→ diarization → state_annotation → intent_classification
```

Root stages (vad, transcription, facial_tracking) fire in parallel. `getReadyStages()` returns pending stages whose deps are all completed and not in `IN_DEVELOPMENT_STAGES`.

## Key Exports (dag.ts)

- `STAGE_DEPS` — dependency map
- `ROOT_STAGES` — entry points
- `STAGE_RESULT_KEYS` — S3 filename per stage (e.g., vad → "voice_activity.json")
- `STAGE_INPUT_KEYS` — what each stage reads (maps input name → source stage or "video")
- `IN_DEVELOPMENT_STAGES` — set of stages to skip (currently: diarization, state_annotation, intent_classification)
- `getResultS3Key(videoId, stage)` → `results/{videoId}/{filename}`
- `buildS3KeysIn(stage, videoId, videoS3Key)` — resolves input S3 keys for a stage
- `getReadyStages(jobs)` — returns stages ready to fire

## Trigger Pattern (trigger.ts)

1. Mark job as **"running" BEFORE the POST** (important: Modal endpoint is synchronous)
2. POST to `${MODAL_BASE_URL}-${STAGE_FUNCTION}.modal.run` (subdomain-per-function URL format)
3. Parse response: set completed/failed
4. After completion: `triggerReadyStages()` cascades dependents
5. Fire triggers with `.then()` (no await) so mutations return immediately

## Phase 4 DAG Extension: Human Gates

After state_annotation/intent_classification complete, human tasks must be submitted AND approved before downstream stages fire:

```typescript
export const HUMAN_GATES: Partial<Record<PipelineStage, TaskType>> = {
  state_annotation: 'verify_states',
  intent_classification: 'verify_intents',
};
```

`getReadyStages` must check: if upstream stage has a human gate, all associated tasks must be in approved status.

On task approval: export edited data to S3 as `{type}_approved.json`, then call `triggerReadyStages`.

## Modal Conventions

- `@modal.fastapi_endpoint` (not `@modal.web_endpoint`)
- `image.add_local_python_source("stages")` (not `modal.Mount`)
- Images need `ffmpeg` apt-installed
- Secret: `AWS_DEFAULT_REGION` (read as both that and `S3_REGION` in utils.py)
