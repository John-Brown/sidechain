# Data Contracts

## Time Conventions

- All times in **seconds** (float). NOT milliseconds.
- Time ranges: `{ start: number; end: number }` — half-open `[start, end)`
- Adjacent segments: no gaps. `[0, 5)` then `[5, 10)`.
- Tolerance for coverage validation: 0.1s (100ms)

## Annotation Types (`@annotation/shared`)

**Pipeline result types** (S3 JSON → annotationDataState):
- `VadResult` → `segments: VadSegment[]` (speech regions with `confidence`) + `frames: VadFrame[]` (per-frame `speech_probability`). **NOTE: uses `segments`/`frames`, NOT `data`**
- `TranscriptionResult` → `data: SpeechWord[]` with `word`, `speaker`, `confidence`, `speech_segment`
- `FacialTrackingResult` → `data: FacialTrackingFrame[]` with `time` (single float, not time_range), `facial_tracking.tracking.*`. Also optional `mesh_keyframes: MeshKeyframe[]` (per-keyframe `depth`) plus `metadata.mesh_topology` / `metadata.depth_estimation` (mesh overlay + Depth Anything V2)
- `DiarizationResult` → `data: DiarizationSegment[]` with `speaker`
- `MouthEnergyResult` → `data: MouthEnergySegment[]` with `mouth_energy`, `blend_shape_energy`
- `StateAnnotationResult` → `data: StateAnnotation[]` with `category` ("expression.state.speaking" | "expression.state.listening")
- `IntentClassificationResult` → `data: IntentAnnotation[]` with `intent` (6 types), `intensity` (3 levels), `valence` (3 levels)
- `WaveformPeaksResult` → **flat shape, NOT `data`**: `peaks_l: number[]`, `peaks_r: number[] | null`, `sample_rate`, `max_peak`, `duration`

**Human-only types** (no pipeline stage): `BackchannelResult` → `data: BackchannelAnnotation[]` with `backchannel { type (5 types), speaker, note }`; `UserLabelResult` → `data: UserLabel[]` with `text`

**Per-item human review** (`AnnotationReview` in `annotation-types.ts`): optional `review { source: "human" | "supervisor_override", confirmed, by?, at?, origin? }` on an item. Absent = AI prediction. Stamped by the viewer on confirm (`confirmed: true`) and on reclassify, create, split, merge and resize/move (`confirmed: false`). Persisted inside the `annotation_sets.data` JSONB. `annotations.save` rejects a `confirm` edit without a target index or a `review.confirmed = true` after-state.

**`review.origin`** is the item's review identity: the `reviewKey` (`start|end|label`) of its ORIGINAL AI form. It is set from the pre-edit item on the first stamp and carried unchanged by later reclassify, resize, move, confirm and split (both halves). A merge takes the lower item's origin, so the upper item's queue row is no longer represented and drops out of the queue (neither open nor ✓). Created items have no origin. A loaded queue row `kind|key` counts as reviewed iff a current human-reviewed item of that kind has `review.origin === key` or exactly that key (`reviewedBaselineKeys`), and never while the key is still open. Undo removes the stamp, so the row reopens.

**Server rules for review stamps** (`annotations.save`, `server/trpc/annotation-save-rules.ts` `stampReviews`):
- **Carried over**: the current version has an item with the same content (review excluded, canonical JSON because jsonb reorders keys) whose stamp has the same `source` and `confirmed`. The stamp keeps that version's `by` / `at`, whatever the client sent. The client never learns the server's values, so this is what stops every save from re-stamping earlier reviews with a new time. A changed item (resize, reclassify) is a new decision and gets a new stamp.
- **Restored**: a non-admin/non-supervisor sends a `supervisor_override` stamp that isn't carried over (an undo of an edit that re-stamped it human). Allowed only if this exact item, stamp included (`source`, `by`, `at`, `confirmed`), is in some earlier `annotation_sets` version of the same `(videoId, type)`, checked with jsonb containment (`data @> '[item]'::jsonb`). The stamp is kept unchanged. Otherwise FORBIDDEN.
- **New**: every other stamp. It must be well formed (`source` is `human` or `supervisor_override`, `confirmed` is a boolean, `origin` is absent or a string), or the save fails with BAD_REQUEST. Its `by` is set to the caller and its `at` to server time. A new `supervisor_override` needs an admin or supervisor.

**All result types** include `AnnotationMetadata`: `source_file`, `format_version`, `created_timestamp`, `total_secs`, `algorithm { name, model, version, processing_time }`.

**IMPORTANT**: Always validate TypeScript types against actual Python pipeline output (check `workers/ml-pipeline/stages/`). VAD and waveform are the stages whose output does not use the `data[]` shape.

## Pipeline Enums (`@annotation/shared`)

- **Stages**: vad, transcription, facial_tracking, waveform, mouth_energy, diarization, state_annotation, intent_classification
- **Job status**: pending, running, completed, failed, cancelled
- **Annotation set types**: state, intent, backchannel, session_bounds, transcription, user_labels
- **Edit types**: create, resize, delete, split, merge, classify, confirm, bulk (`confirm` = a human accepted an AI prediction unchanged; migration `0004`)
- **Task types**: tag_session_bounds, verify_states, verify_intents, tag_backchannels
- **Task status**: pending, assigned, in_progress, submitted, under_review, approved, rejected
- **Annotation source**: ai, human, supervisor_override

## S3 Key Conventions

- Uploads: `videos/{projectId}/{videoId}/{filename}`
- Pipeline results: `results/{videoId}/{stage_key}.json` (e.g., `voice_activity.json`, `speech_transcription.json`)
- Approved human edits: `results/{videoId}/{type}_approved.json`

## Schema Notes (packages/db)

- `annotation_sets`: versioned JSONB with `is_current` partial unique index on `(videoId, type)`
- `annotation_edits`: audit log — `editType`, `targetIndex`, `beforeState`, `afterState`
- `tasks`: `constraints` JSONB = `TaskConstraints`, tracks `timeSpentSecs`, `editCount`
- `processing_jobs`: unique on `(videoId, stage)`, tracks `progress` 0-100

## Coverage Rules

- **States**: must be contiguous (partition the full timeline). Enforced on task submit.
- **Intents, backchannels**: sparse. Gaps allowed and expected.
- **Transcription**: sparse per word. No coverage requirement.
