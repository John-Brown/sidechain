# Development Log

## 2026-02-08 — Phase 4.1: User Labels Track + Editing Polish

### User labels — new human-only annotation type
- `UserLabel { time_range, text }` + `UserLabelResult` in `@annotation/shared`
- `user_labels` added to `annotationSetTypeEnum`, migration `0002_yielding_ultragirl.sql`
- Full editor integration: `userLabels` field + `userLabelHistory` in EditorState, all undo/redo/enter/exit switch cases
- EditableDOMTrack: violet `.block-user-label` blocks with drag-resize + drag-move
- `LabelTextDialog.svelte` — text input on double-click or C key, dark theme aware
- `CreateAnnotationBar.svelte` — "Label" button creates at playhead with 1s duration
- View mode persistence: on exiting edit mode, labels write back to `annotationData.userLabels`; read-only DOMTrack renders them

### Drag-to-move (all editable blocks)
- Extended `DragEdge` union: `'left' | 'right' | 'move'`
- Block body `pointerdown` initiates move drag (3px threshold distinguishes click from drag)
- Move preserves duration, clamps to timeline bounds
- Cursor: `grab` on blocks, `grabbing` while dragging, `col-resize` on handles
- 6 new tests for move in `drag-resize.test.ts`

### UI improvements
- `KeyboardShortcutsHelp.svelte` — redesigned as two-column overlay with individual `<kbd>` pills, edit-only amber badges
- `ViewerHeader.svelte` — explicit "Save" button when changes are dirty (in addition to Cmd+S and 30s auto-save)

### Svelte 5 proxy fix (pre-existing bug surfaced)
- `structuredClone` on `$state` proxies throws `DataCloneError`
- Fixed in 4 locations: `enterEditMode`, `pushUndo` (CreateAnnotationBar, AnnotationViewer, EditableDOMTrack)
- Pattern: always `structuredClone($state.snapshot(value))`, never `structuredClone(value)` on reactive state

### Test results
- 191 passing across 12 suites (was 185 before move tests)

### Files added (3)
- `apps/web/src/lib/components/viewer/components/LabelTextDialog.svelte`
- `packages/db/drizzle/0002_yielding_ultragirl.sql`
- `packages/db/drizzle/meta/0002_snapshot.json`

### Files modified (16)
- `packages/shared/src/annotation-types.ts` — UserLabel, UserLabelResult
- `packages/shared/src/pipeline-types.ts` — user_labels enum
- `packages/shared/src/index.ts` — exports
- `packages/db/src/schema.ts` — user_labels enum value
- `apps/web/src/lib/components/viewer/state/editor.svelte.ts` — userLabels + history
- `apps/web/src/lib/components/viewer/state/annotation-data.svelte.ts` — userLabels property
- `apps/web/src/lib/components/viewer/state/autosave.svelte.ts` — userLabels mapping
- `apps/web/src/lib/components/viewer/editing/drag-resize.ts` — move edge type
- `apps/web/src/lib/components/viewer/editing/drag-resize.test.ts` — move tests
- `apps/web/src/lib/components/viewer/tracks/EditableDOMTrack.svelte` — move + userLabels history
- `apps/web/src/lib/components/viewer/AnnotationViewer.svelte` — user labels track, view mode, CreateAnnotationBar
- `apps/web/src/lib/components/viewer/ViewerHeader.svelte` — Save button
- `apps/web/src/lib/components/viewer/components/CreateAnnotationBar.svelte` — Label button
- `apps/web/src/lib/components/viewer/components/KeyboardShortcutsHelp.svelte` — two-column redesign
- `apps/web/src/lib/components/viewer/viewer.css` — block-user-label color

---

## 2026-02-08 — Project Management (Tier 1): Detail Page, Members, Guidelines, Dashboard

### Schema changes
- New `project_status` enum: `active | paused | completed | archived`
- `projects` table: added `status`, `guidelines` (text), `guidelinesUpdatedAt`, `updatedAt`
- `profiles` table: added `email` (nullable, backfilled from Supabase auth on next login)
- `@annotation/shared`: added `PROJECT_STATUSES` const + `ProjectStatus` type
- Migration: `0001_chunky_lady_deathstrike.sql`

### Backend (tRPC projects router: 3 → 10 procedures)
- Extracted `requireMembership(db, projectId, userId, requiredRoles?)` helper — reusable auth guard
- `get` — full project + caller's role (any member)
- `update` — name/description/status (admin only)
- `updateGuidelines` — markdown content (admin or supervisor)
- `delete` — cascade delete with admin check
- `listMembers` — join profiles for display name + email
- `addMember` — look up by email, prevent duplicates
- `updateMemberRole` — with last-admin guard
- `removeMember` — with last-admin guard, can't remove self
- `dashboard` — 4-way `Promise.all`: video/job/task stats + recent videos
- Expanded `list` to return `status` + `updatedAt`

### Profile email population
- `context.ts` now includes `email` in all profile queries
- Auto-create includes `email` from Supabase user
- Backfill on login: if profile.email is null but Supabase user has email, update it
- Enables member-add-by-email flow

### Frontend
- New route `/projects/[id]` — tabbed detail page with URL-synced tab state (`?tab=`)
- `ProjectOverview` — stats grid (videos, ready, running jobs, pending tasks), pipeline health badges, recent videos
- `ProjectSettings` — edit form (admin only), danger zone delete with two-step confirmation
- `ProjectMembers` — member table, add-by-email form, inline role dropdown, remove button (all admin-gated)
- `ProjectGuidelines` — markdown editor with write/preview toggle, rendered read-only for annotators, `marked` + `dompurify`
- Updated `/projects` list — cards link to detail, status badges, updatedAt, quick-open arrow for direct video navigation
- Project store gains `role` field, propagated through layout sidebar

### Safety constraints
- Last-admin protection: can't demote or remove the last admin
- Self-removal blocked (prevents accidental lockout)
- Duplicate member detection on add
- Email lookup fails gracefully if user hasn't signed up

### Dependencies added
- `marked` (~35KB) — markdown rendering
- `dompurify` — HTML sanitization
- `@types/dompurify` — dev types

### Files added (8)
- `apps/web/src/routes/projects/[id]/+page.server.ts`
- `apps/web/src/routes/projects/[id]/+page.svelte`
- `apps/web/src/lib/components/project/ProjectOverview.svelte`
- `apps/web/src/lib/components/project/ProjectSettings.svelte`
- `apps/web/src/lib/components/project/ProjectMembers.svelte`
- `apps/web/src/lib/components/project/ProjectGuidelines.svelte`
- `packages/db/drizzle/0001_chunky_lady_deathstrike.sql`
- `packages/db/drizzle/meta/0001_snapshot.json`

### Files modified (7)
- `packages/db/src/schema.ts` — new enum + 5 columns
- `packages/shared/src/pipeline-types.ts` — PROJECT_STATUSES
- `packages/shared/src/index.ts` — exports
- `apps/web/src/lib/server/trpc/routers/projects.ts` — 7 new procedures
- `apps/web/src/lib/server/trpc/context.ts` — email handling
- `apps/web/src/lib/stores/project.svelte.ts` — role in store
- `apps/web/src/routes/projects/+page.svelte` — card redesign

### Future tiers documented
- See `plans/project-management-future-tiers.md`
- Tier 2: pipeline config, QC settings, task assignment, invitations, guidelines versioning
- Tier 3: taxonomy editor, export presets, templates, archiving, analytics, audit log UI

---

## 2026-02-07 — Phase 2 QA: Local Dev Setup + Pipeline Fixes

### What was done
- Set up local Supabase (Postgres + Auth + S3-compatible storage) for dev
- Fixed all `process.env` usages to SvelteKit `$env` imports (context.ts, trigger.ts, callback, s3.ts)
- Fixed Supabase SSR auth: rewrote context.ts to use `event.locals.safeGetSession()` + auto-create profile rows
- Fixed hooks.server.ts: call `getUser()` before `getSession()` to suppress Supabase auth warning
- Migrated to real AWS S3 (`sidechain-annotation-dev` bucket in us-west-2) for Modal accessibility
- Configured S3 CORS for browser-based multipart uploads from localhost

### Modal deployment fixes
- `modal.Mount` removed in v1.3+ — migrated to `image.add_local_python_source("stages", copy=True)`
- `@modal.web_endpoint` deprecated — replaced with `@modal.fastapi_endpoint`
- Added `fastapi[standard]` to all images
- Added `ffmpeg` + `libsndfile1` + `soundfile` to audio-processing images
- VAD: `torchaudio.load()` now requires torchcodec — replaced with ffmpeg + soundfile pipeline
- VAD: Silero VAD v5 window size changed from 1600 to 512 samples
- Facial tracking: `mp.solutions.face_mesh` removed — migrated to `mediapipe.tasks.python.vision.FaceLandmarker`
- Modal URL format: subdomain-per-function (`${BASE}-${FUNCTION}.modal.run`)

### Trigger architecture change
- Modal `@fastapi_endpoint` is synchronous (HTTP blocks until function completes)
- trigger.ts now: sets "running" before POST, parses response body for completed/failed
- tRPC mutations fire triggers with `.then()` (no await) so they return immediately
- `triggerReadyStages()` auto-cascades dependent stages after completion

### New features
- Video delete (UI + S3 cleanup + DB cascade)
- Refresh button on video detail page
- "In development" badge for stages not yet production-ready

### Stages status
| Stage | Status | Notes |
|-------|--------|-------|
| vad | Working | Silero VAD v5, ffmpeg + soundfile audio loading |
| transcription | Working | faster-whisper large-v3, GPU (A10G) |
| facial_tracking | Working | MediaPipe FaceLandmarker task API |
| mouth_energy | Working | Depends on facial_tracking output |
| diarization | In Development | pyannote `use_auth_token` API change needs fix |
| state_annotation | In Development | Depends on diarization |
| intent_classification | In Development | Depends on state_annotation + Anthropic API key |

### Known issues
- No tunnel for Modal callbacks — dependent stages auto-chain via `triggerReadyStages()` instead
- Diarization fails: `Pipeline.from_pretrained() got an unexpected keyword argument 'use_auth_token'`
- No favicon (404s on /favicon.ico, /apple-touch-icon.png — harmless)

---

## 2026-02-08 — Viewer Overhaul: Layout, Waveform, VAD Fix, Head Pose, Audit Skill

### Layout restructure
- Split timeline into two-column layout: fixed 120px label column + scrollable content area
- Labels no longer scroll away horizontally — `TrackLabel.svelte` and `TrackContent.svelte` replace `TrackRow.svelte`
- Playhead now uses absolute positioning (x=0 = time 0), fixing the 120px offset bug

### Zoom + scrub fixes
- Default zoom now fits video duration to viewport width (`fitZoomToContainer()`)
- Proportional wheel zoom (10% per notch) — max raised from 20 to 100 px/s
- Fixed double-scroll bug: all draw functions converted from viewport-relative to absolute pixel positioning
- Fixed `scrubAt` in CanvasTrack — `getBoundingClientRect` already accounts for scroll offset

### Audio waveform track
- New `extract-waveform.ts`: fetches video URL → Web Audio API `decodeAudioData` → peak extraction at 200 peaks/sec
- Supports stereo (top/bottom halves, cyan/pink) and mono (mirrored bars)
- Non-blocking extraction with loading state

### VAD data contract fix (root cause of missing VAD track)
- **Problem**: Python pipeline outputs `{ metadata, segments, frames }` but TypeScript `VadResult` expected `{ metadata, data }` with nested `voice_activity.speech_probability` + energy fields
- `annotations.vad?.data` silently returned `undefined` since the actual key is `frames`
- **Fix**: Rewrote `VadResult` type to match pipeline: `segments: VadSegment[]` + `frames: VadFrame[]`
- Removed phantom "Energy" track — pipeline produces no energy data
- Added error state visibility for all tracks (was hiding tracks silently on S3 fetch failure)
- Added diagnostic console logging for data loading pipeline

### Data contract validation
- Validated all 7 pipeline stages' Python output against TypeScript types
- VAD was the only mismatch — all others (transcription, facial_tracking, mouth_energy, diarization, state_annotation, intent_classification) use `data` and match correctly
- Updated `data-contracts.md` rule with accurate field names per stage

### Head pose track (from facial tracking)
- New `drawHeadPose` — three colored lines: pitch (amber), yaw (indigo), roll (emerald)
- Custom binary search for `FacialTrackingFrame` (uses `time` not `time_range`)
- Lazy-loaded separately from `getAllResults` (too large for batch response)

### Pipeline audit skill
- Created `/audit-pipeline` skill at `.claude/skills/audit-pipeline/`
- Traces data end-to-end: Python output → S3 → TypeScript types → viewer loading → draw functions
- Includes `expected-shapes.md` reference with validated JSON shapes for all 7 stages
- Invoke with `/audit-pipeline <video-id>` or `/audit-pipeline types-only`

### Files added
- `apps/web/src/lib/components/viewer/tracks/TrackLabel.svelte`
- `apps/web/src/lib/components/viewer/tracks/TrackContent.svelte`
- `apps/web/src/lib/components/viewer/utils/extract-waveform.ts`
- `.claude/skills/audit-pipeline/SKILL.md`
- `.claude/skills/audit-pipeline/expected-shapes.md`

### Track order (top → bottom)
Time → Waveform → VAD → Head Pose → Mouth Energy → Transcription

### Picture-in-Picture video pop-out
- Toggle via header button or `P` key — floats video via browser PiP API
- Left panel CSS-collapses to `w-0 overflow-hidden` (not `{#if}` removal — destroying `<video>` kills PiP)
- `ResizeObserver` on timeline container auto-fires → `containerWidth` updates → all tracks redraw at full viewport width
- `leavepictureinpicture` event handles both button toggle and native browser PiP close
- `SessionState` gains `pipActive` / `pipSupported`; feature-detected via `document.pictureInPictureEnabled`
- PiP events not in Svelte's HTMLVideoElement type defs — attached imperatively in `onMount`, cleaned up on destroy
- Button hidden entirely when browser doesn't support PiP (`pipSupported` gate)

---

## 2026-02-08 — Phase 4 Prep: Backend Hardening, Command Types, Editor Foundation

### Project audit
- Full codebase audit across 5 domains: frontend, backend/tRPC, shared packages/DB, ML pipeline, plans/docs
- Identified 10 critical issues in backend code (all fixed below)
- Validated all pipeline data contracts, schema alignment, and type coverage

### AI-first architecture
- Created `.claude/rules/ai-first.md` — command layer pattern for agent/NL-accessible state mutations
- All editing operations flow through `AnnotationCommand → CommandExecutor → state mutation`
- Semantic targeting: annotations addressable by index, id, time, timeRange, selected, or query filter
- Dual execution: same commands work client-side (Svelte) and server-side (tRPC)

### Backend hardening (Stream A)
- Replaced 18 `throw new Error()` with `TRPCError` (NOT_FOUND, FORBIDDEN, BAD_REQUEST) across videos.ts + processing.ts
- Added project membership check to `getJobStatus` (was accessible to any authenticated user)
- Changed auto-created profile default role from "admin" to "annotator"
- Callback handler: timing-safe secret comparison (`crypto.timingSafeEqual`), deduplication (skip if already completed), race condition fix (fresh DB query after update)
- Modal response validation: Zod schema replaces `as` type assertion in trigger.ts
- Re-gated IN_DEVELOPMENT_STAGES: diarization, state_annotation, intent_classification

### Shared types (Stream B)
- Extended `AnnotationData` union with `transcription` + `session_bounds` variants
- Created `packages/shared/src/command-types.ts`:
  - `AnnotationTarget` — 6-variant discriminated union for semantic addressing
  - `AnnotationCommand` — 8 action types (select, create, resize, delete, split, merge, classify, bulk)
  - `CommandResult` — structured ok/error with `suggestedFix`
  - `TaskConstraints` — editableTypes, allowedCategories, lockedTimeRanges, allowedOperations
  - `TargetFilter` — duration, category, confidence criteria

### Editor foundation (Stream C)
- `state/history.svelte.ts` — Generic `History<T>` class, snapshot undo/redo via structuredClone, max 50
- `state/editor.svelte.ts` — `EditorState` class with editable arrays (states, intents, transcription, backchannels), per-type history + dirty tracking, Symbol-keyed context
- `editing/operations.ts` — 6 pure functions: resize, delete, split, merge, create, classify (all return new arrays)
- `editing/time-validation.ts` — bounds check, overlap detection, contiguity validation, locked range enforcement

### Files added
- `.claude/rules/ai-first.md`
- `packages/shared/src/command-types.ts`
- `apps/web/src/lib/components/viewer/state/history.svelte.ts`
- `apps/web/src/lib/components/viewer/state/editor.svelte.ts`
- `apps/web/src/lib/components/viewer/editing/operations.ts`
- `apps/web/src/lib/components/viewer/editing/time-validation.ts`

### What's unblocked for Phase 4
- Wave 2: EditableDOMTrack with drag-to-resize (operations + validation ready)
- Wave 3: CRUD UI (operations ready)
- Wave 4: Auto-save + tRPC annotations/tasks routers (command types ready)
- Command executor: bridge between command types and operations
