---
name: audit-pipeline
description: Audit the end-to-end data pipeline for a video — from processing jobs through S3 JSON to viewer rendering. Use to diagnose why a track isn't showing, validate data contracts, or verify a new pipeline stage.
argument-hint: "[video-id or 'types-only']"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(pnpm *), Agent
---

# Pipeline Data Audit

Audit the data pipeline end-to-end for video `$ARGUMENTS`. If the argument is `types-only`, skip database/S3 checks and only validate TypeScript types against Python stage implementations.

## Audit Stages

Run each stage in order. Report findings as a table at the end.

### Stage 1: TypeScript ↔ Python Shape Validation

For each pipeline stage, compare the **Python output shape** (what the Modal function writes to S3) against the **TypeScript type** (what the viewer expects to consume).

1. Read the TypeScript types from `packages/shared/src/annotation-types.ts`
2. Read each Python stage implementation from `workers/ml-pipeline/stages/`:
   - `vad.py` → `VadResult`
   - `transcription.py` → `TranscriptionResult`
   - `facial_tracking.py` → `FacialTrackingResult`
   - `mouth_energy.py` → `MouthEnergyResult`
   - `diarization.py` → `DiarizationResult`
   - `state_annotation.py` → `StateAnnotationResult`
   - `intent_classification.py` → `IntentClassificationResult`
   - `waveform.py` → `WaveformPeaksResult` (flat shape, no `data[]`)

3. For each stage, verify:
   - **Top-level keys**: Does the Python dict match the TS interface? (e.g., `data` vs `segments`/`frames`)
   - **Array field name**: Is it `data`, `segments`, `frames`, or something else?
   - **Nested field structure**: Do nested object keys match? (e.g., `voice_activity.speech_probability` vs flat `speech_probability`)
   - **Metadata fields**: Are extra metadata fields present in Python but missing from TS?

Report mismatches with exact field paths. Reference the expected shapes in [expected-shapes.md](expected-shapes.md).

If argument is `types-only`, stop here.

### Stage 2: Database Job Status

Check processing job records for the video.

1. Read the tRPC router at `apps/web/src/lib/server/trpc/routers/processing.ts`
2. Read the DAG config at `apps/web/src/lib/server/pipeline/dag.ts`
3. Verify:
   - Which stages have jobs? (some may not exist if pipeline wasn't triggered)
   - What is each job's status? (`pending`, `running`, `completed`, `failed`, `cancelled`)
   - Does the `resultS3Key` follow the expected pattern: `results/{videoId}/{STAGE_RESULT_KEYS[stage]}`?
   - Is the stage in `IN_DEVELOPMENT_STAGES`? (gated stages won't run)

If the user can provide the output from the video detail page's "View results" button or browser console logs, use that. Otherwise, guide them to check.

### Stage 3: S3 Result Key Mapping

Verify the S3 key conventions are consistent.

1. Read `STAGE_RESULT_KEYS` from `apps/web/src/lib/server/pipeline/dag.ts`
2. Read the Python stage implementations to find what S3 key each stage writes to
3. Verify the keys match:

   | Stage | Expected S3 filename |
   |-------|---------------------|
   | vad | `voice_activity.json` |
   | transcription | `speech_transcription.json` |
   | facial_tracking | `facial_tracking.json` |
   | mouth_energy | `mouth_energy.json` |
   | diarization | `diarization.json` |
   | state_annotation | `annotations.json` |
   | intent_classification | `intent_classification_annotations.json` |
   | waveform | `waveform_peaks.json` |

### Stage 4: Viewer Data Loading

Trace how data flows from the tRPC response to the viewer state and rendering.

1. Read `apps/web/src/lib/components/viewer/AnnotationViewer.svelte`
2. For each stage, trace the chain:
   - **getAllResults** → how does the tRPC response map stage data? (`results[stage]`)
   - **State assignment** → what field is assigned? (e.g., `annotations.vad = results.vad`)
   - **Data access** → what property does the `has*` flag check? (e.g., `annotations.vad?.frames` vs `.data`)
   - **Draw function** → what property does the draw wrapper pass? (e.g., `annotations.vad.frames`)
3. For DOM tracks (transcription, states, intents), also check the `getStart`/`getEnd`/`blockLabel` accessor functions

### Stage 5: Draw Function ↔ Data Shape

Verify each draw function accesses fields that actually exist in the data.

1. Read `apps/web/src/lib/components/viewer/tracks/draw-functions.ts`
2. For each draw function, check:
   - Does it access the correct nested fields? (e.g., `frame.speech_probability` not `frame.voice_activity.speech_probability`)
   - Does the binary search work? (items need `time_range.start`/`.end` or `time` field)
   - Are there dead-code references to fields that don't exist in the actual data?

## Output Format

Produce a summary table:

```
| Stage | TS↔Python | S3 Key | Viewer Load | Draw Fn | Status |
|-------|-----------|--------|-------------|---------|--------|
| vad   | OK        | OK     | OK          | OK      | PASS   |
| ...   | ...       | ...    | ...         | ...     | ...    |
```

For any FAIL, include:
- **What's wrong**: Exact field mismatch or missing data
- **Where**: File path and line number
- **Fix**: Specific code change needed

## Common Failure Patterns

These are documented issues to watch for:

1. **`data` vs custom keys**: Most stages use `data` as their array field. VAD uses `segments` + `frames`. Always verify.
2. **Nested vs flat fields**: Python may output `speech_probability` flat while TS expects `voice_activity.speech_probability`.
3. **`time` vs `time_range`**: Facial tracking uses `time` (single float). All others use `time_range: {start, end}`.
4. **Phantom fields**: TS types may include fields (like `energy_dbfs`) that the Python pipeline doesn't produce.
5. **S3 fetch errors are silent**: `getAllResults` catches S3 errors per-stage and returns `null`. The viewer sets status to `'error'` but may hide the track entirely if `show*` doesn't check for error state.
