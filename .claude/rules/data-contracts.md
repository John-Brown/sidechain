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

**All result types** include `AnnotationMetadata`: `source_file`, `format_version`, `created_timestamp`, `total_secs`, `algorithm { name, model, version, processing_time }`.

**IMPORTANT**: Always validate TypeScript types against actual Python pipeline output (check `workers/ml-pipeline/stages/`). VAD and waveform are the stages whose output does not use the `data[]` shape.

## Pipeline Enums (`@annotation/shared`)

- **Stages**: vad, transcription, facial_tracking, waveform, mouth_energy, diarization, state_annotation, intent_classification
- **Job status**: pending, running, completed, failed, cancelled
- **Annotation set types**: state, intent, backchannel, session_bounds, transcription, user_labels
- **Edit types**: create, resize, delete, split, merge, classify, bulk
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
