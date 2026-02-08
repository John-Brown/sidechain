# Data Contracts

## Time Conventions

- All times in **seconds** (float). NOT milliseconds.
- Time ranges: `{ start: number; end: number }` — half-open `[start, end)`
- Adjacent segments: no gaps. `[0, 5)` then `[5, 10)`.
- Tolerance for coverage validation: 0.1s (100ms)

## Annotation Types (`@annotation/shared`)

**Pipeline result types** (S3 JSON → annotationDataState):
- `VadResult` → `VadSegment[]` with `speech_probability`, `energy_dbfs`
- `TranscriptionResult` → `SpeechWord[]` with `word`, `speaker`, `confidence`, `speech_segment`
- `DiarizationResult` → `DiarizationSegment[]` with `speaker`
- `MouthEnergyResult` → `MouthEnergySegment[]` with `mouth_energy`, `blend_shape_energy`
- `StateAnnotationResult` → `StateAnnotation[]` with `category` ("expression.state.speaking" | "expression.state.listening")
- `IntentClassificationResult` → `IntentAnnotation[]` with `intent` (6 types), `intensity` (3 levels), `valence` (3 levels)

**All result types** include `AnnotationMetadata`: `source_file`, `format_version`, `created_timestamp`, `total_secs`, `algorithm { name, model, version, processing_time }`.

## Pipeline Enums (`@annotation/shared`)

- **Stages**: vad, transcription, facial_tracking, mouth_energy, diarization, state_annotation, intent_classification
- **Job status**: pending, running, completed, failed, cancelled
- **Annotation set types**: state, intent, backchannel, session_bounds, transcription
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
