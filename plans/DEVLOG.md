# Development Log

## 2026-09-24 — Design pass: Deco Parchment timeline viewer

Implemented the Claude Design "Deco Parchment" pass on `feat/design-pass` (one PR, based on PR #1). All 12 design notes for the timeline viewer are in; other app pages only picked up the tokens and fonts and lost their hardcoded Tailwind hues. Verified: 382/382 tests (18 files), svelte-check 0 errors / 0 warnings, `pnpm --filter web build` OK, `@annotation/db` and `@annotation/shared` typecheck OK.

### Changes
- **Tokens and fonts**: Day/Night token set in `app.css` (Day default, Night = `.dark`), `viewer.css` and `viewer-palette.ts` kept in sync; data hues `--hue-*`; 2px radius, no shadows, 150–200ms color transitions. Fonts self-hosted via @fontsource (DM Sans Variable, IBM Plex Mono 400/500, DM Serif Display); `@fontsource-variable/inter` removed. bits-ui 2.x re-added for overlays only (Dialog, DropdownMenu, Slider).
- **Layout**: 48px header, Edit/Task toolbar, 400px top band (video 711 · Inspector 460 · review queue or task panel), 28px ruler outside the vertical scroll, grouped tracks (Audio / Face / Annotations) with sticky 184px labels, 30px overview, 24px status bar.
- **Track layout** (`state/tracks.svelte.ts`, on `session.tracks`): one config array with per-mode heights, collapse and order per user; resize and reorder move a guide and commit on pointerup. View and edit share one layout, task has its own.
- **Review**: `review.ts` (`LOW_CONFIDENCE` 0.6, provenance, queue, ⇥ navigation, task checklist), ReviewQueue, Inspector Confirm/Reclassify, ↵ confirm. New `confirm` edit type in `@annotation/shared` + `edit_type` enum, with migration `0004_soft_jamie_braddock.sql` (generated only, not run). `annotations.save` validates confirm edits and task `allowedOperations`.
- **Blocks**: one `blk hue-*` recipe with state in attributes (`data-source`, `data-lowconf`, `aria-selected`, `data-locked`), roving tabindex, 4px teal handles on the selected block, `.blk-ghost` drag origin. States, intents and backchannels tracks are now rendered and editable; diarization is wired as a read-only canvas lane.
- **Overlays mounted**: ClassifyDialog, LabelTextDialog, ContextMenu (right-click / menu key), TaskSubmitDialog, KeyboardShortcutsHelp.
- **Dev fixture**: `/dev/viewer?mode=view|edit|task&theme=day|night&t=53.6` renders AnnotationViewer from `fixtures/generate.ts` (deterministic port of the design's `timeline-data.js`) without DB, tRPC or auth; 404 outside dev.
- **Fixes found on the way**: undo threw `DataCloneError` on the first ⌘Z (`history.svelte.ts`); an empty `<video>` reset the playhead to 0.
- **Review follow-up (critic gaps)**:
  - Clicking a review-queue row no longer disables the viewer shortcuts; a pointer click refocuses the viewer root so ↵ confirms and ⇥ steps (task mini-queue too).
  - `/dev/viewer` renders full-screen outside the app shell.
  - The theme store defaults to Day. `app.html` only goes Night for a stored `dark` or `system` on a dark OS, and the canvas palette follows the `.dark` class through a MutationObserver. `?theme=` no longer overwrites the saved theme.
  - Space and slider arrows stay with a focused control; ⇥ on a focused block moves between tracks.
  - A global 2px teal `:focus-visible` outline; app-page fields use outlines instead of `ring-*`; the ReviewQueue list shows focus.
  - The TaskPanel fallback brief is a sentence, not raw enums.
  - State coverage gaps block Submit again (matches `data-contracts.md`), and the time on task is MM:SS.
  - ⌘E keeps track heights.
  - ClassifyDialog disables the categories a task doesn't allow.
  - Low-confidence border at 90%; a single playhead cap; overview window fill from the palette (5% / 10%); head pose ±30°; 13px `text-viewer-md` token; short task ref (`T-XXXX`) in the header; header zoom is a bits-ui Slider; TrackLabel fits "Transcription" + lock + count.
  - Removed `shadow-md` and `transition-all` from app pages; the fixture generator is lazy-loaded after the dev guard; undo/redo clears a stale selection; `drawDiarization` is binary-search culled.

### Files changed
- Modified: `CLAUDE.md`, `.claude/rules/{data-contracts,editing,performance,style-guide,testing,viewer}.md`, `plans/DEVLOG.md`, `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/{app.css,app.html}`, `apps/web/src/lib/stores/theme.svelte.ts`, `apps/web/src/lib/components/{ThemeToggle.svelte,upload/VideoUpload.svelte,project/{ProjectGuidelines,ProjectMembers,ProjectOverview,ProjectSettings}.svelte}`, `apps/web/src/lib/components/viewer/{AnnotationViewer,InspectorPanel,Playhead,VideoPlayer,ViewerHeader}.svelte`, `viewer/{data-loader.ts,viewer-palette.ts,viewer.css}`, `viewer/components/{ClassifyDialog,ContextMenu,DraftRecoveryBanner,KeyboardShortcutsHelp,LabelTextDialog,MeshOverlay,SaveIndicator,TaskPanel,TaskSubmitDialog}.svelte`, `viewer/state/{autosave,editor,history,session,task-mode}.svelte.ts`, `viewer/state/editor.test.ts`, `viewer/tracks/{CanvasTrack,DOMTrack,EditableDOMTrack,TrackContent,TrackLabel}.svelte`, `viewer/tracks/draw-functions.ts`, `apps/web/src/lib/server/trpc/routers/annotations.ts`, `apps/web/src/routes/{+layout.svelte,auth/login/+page.svelte,auth/signup/+page.svelte,projects/+page.svelte,projects/[id]/+page.svelte,videos/+page.svelte,videos/[id]/+page.svelte}`, `packages/db/{src/schema.ts,drizzle/meta/_journal.json}`, `packages/shared/src/{annotation-types,command-types,index,pipeline-types}.ts`
- Renamed: `viewer/components/CreateAnnotationBar.svelte` → `viewer/components/EditToolbar.svelte`
- New: `viewer/{review.ts,review.test.ts}`, `viewer/components/{ReviewQueue,TaskToolbar,TimelineOverview,ViewerStatusBar}.svelte`, `viewer/state/{tracks.svelte.ts,tracks.test.ts,task-mode.test.ts}`, `viewer/tracks/{TrackGroup.svelte,draw-functions.test.ts}`, `viewer/fixtures/{generate.ts,generate.test.ts}`, `apps/web/src/routes/dev/viewer/{+page.svelte,+page.ts}`, `packages/db/drizzle/{0004_soft_jamie_braddock.sql,meta/0004_snapshot.json}`
- Deleted: `viewer/utils/focus-trap.ts` (bits-ui Dialog traps focus), `viewer/utils/push-undo.svelte.ts`

### Known gaps
- Zoom doesn't keep an anchor point (header or ⌘-wheel zoom keeps scrollLeft in px).
- Diarization turns can't be selected for the Inspector (read-only canvas lane).
- `videos.get` doesn't return the project name, so the header shows it only for the fixture.
- bits-ui Tooltip isn't used; icon buttons keep `title` attributes.
- `allowedCategories` and `lockedTimeRanges` are enforced in the UI only, not in `annotations.save`.

---

## 2026-09-24 — Docs Freshness Audit (after 7-month gap)

Checked CLAUDE.md, `.claude/rules/`, the audit-pipeline skill, `plans/`, and `reference/` against the code. Health check passed: 244/244 tests, svelte-check 0 errors, build OK.

### Changes
- CLAUDE.md: Phase 4 marked complete (command executor + router tests deferred); 8 stages; transcription = WhisperX + large-v3-turbo; facial_tracking T4 + Depth Anything V2; diarization A10G, auth fixed; RLS section replaced with the actual authorization model (no policies exist; checks live in tRPC); missing env vars; removed shadcn-svelte/bits-ui claims; updated viewer file map
- Rules: viewer.md (5 contexts, new tracks, LOD, mesh overlay, real hierarchy); editing.md (`History<T>` class; executor is unbuilt); ai-first.md (status banner: types only); data-contracts.md (waveform stage + result types, mesh/depth fields); trpc.md (UserInfo, publicProcedure, requireMembership, CONFLICT); pipeline.md (correct DAG, human gates shipped, GPUs); testing.md (real coverage table, 244 tests); docs.md (`paths:` frontmatter); style-guide.md (warning palette, TrackRow removed)
- Skill audit-pipeline: added waveform stage; `Task` → `Agent` tool name
- Moved `plans/phase-4-editing-task-mode.md` → `plans/archive/`
- INDEX.md: flagged reference 01–04 as Phase 0 spike era, added PIPELINE.md
- Fixed broken links in reference/01, 02, 04, 05

### Files changed
- Modified: `CLAUDE.md`, `.claude/rules/{viewer,editing,ai-first,data-contracts,trpc,pipeline,testing,docs,style-guide}.md`, `.claude/skills/audit-pipeline/{SKILL,expected-shapes}.md`, `plans/INDEX.md`, `plans/DEVLOG.md`, `reference/{01,02,04,05}-*.md`
- Moved: `plans/phase-4-editing-task-mode.md` → `plans/archive/`

### Cleanup

Four implementers ran in parallel on top of the audit above: pipeline model/SDK bump, dead-code removal, missing-test backfill, and a reference-docs reorg. Verified afterward: 270/270 tests, svelte-check 0 errors, build OK, `uv sync --frozen` + both pipeline module imports OK.

- **Pipeline model/SDK**: `intent_classification.py` now uses a `CLAUDE_MODEL = "claude-sonnet-5"` constant (was hardcoded `claude-sonnet-4-5-20250929` in two places); `anthropic` bumped `>=0.30` → `>=1.0` (`pyproject.toml`, `uv.lock`, `modal_app.py`'s `intent_image` pip_install); diarization docstrings reworded to "pyannote.audio (pyannote/speaker-diarization-3.1 pipeline)"; `PIPELINE.md` model/SDK mentions updated to match.
- **Dead code removed**: duplicate `viewer/editing/history.test.ts` (cases merged into `viewer/state/history.test.ts`, now 15 tests); unused `viewer/tracks/TrackRow.svelte`; unused `$lib/utils.ts` (shadcn `cn()` helper); deps `bits-ui`, `tailwind-variants`, `@types/dompurify`, `clsx`, `tailwind-merge` removed from `apps/web/package.json` (dompurify 3.3.1 ships its own types). `.gitignore` gained `**/.DS_Store` so `packages/.DS_Store` stops reappearing in status.
- **New tests**: `viewer/utils/group-words.test.ts` (12 tests) and `viewer/mesh-overlay.test.ts` (21 tests), covering the transcription-LOD grouping and keyframe depth interpolation modules added in the prior entry below.
- **Reference docs reorg**: Phase 0 docs 01, 03–06 moved to `plans/archive/phase-0-reference/` with archive banners (superseded by current code — Silero v3.1→v5, OpenAI/MLX Whisper→WhisperX/faster-whisper, FaceKitRunner→MediaPipe, Swift app gone). `02-algorithm-reference.md` (1452 lines) split into `02a`–`02d` (vad/transcription/face, mouth/diarization/states, intents/summary, phase-0 extras), each under 500 lines with a status banner and current-file pointers. `07-facial-tracking-reference.md` re-bannered (MediaPipe FaceLandmarker, not FaceKitRunner). `cloud-infrastructure.md`, `getting-started.md`, `local-to-aws-migration.md`, `system-flow.md` fixed against `modal_app.py`/`dag.ts` (8 stages incl. waveform, facial_tracking + diarization on GPU, real app name/secrets, current result filenames). `plans/viewer-code-review.md` moved to `plans/archive/`. `docs.md` gained lifecycle/size rules for archiving and splitting. `plans/INDEX.md` rewritten to match.
- **Doc fixes applied on top of the above** (this session): `CLAUDE.md` — `viewer-code-review.md` path corrected to `plans/archive/`, bits-ui sentence corrected, Reference Docs section updated (setup/system-flow/infra/02a–02d, added `plans/archive/phase-0-reference/` row), `docs.md` rules-table row noted archive/split rules, `ContextMenu` flagged `(unwired)` in the viewer file map; `reference/cloud-infrastructure.md` model ID updated to `claude-sonnet-5`; `.claude/rules/testing.md` coverage table recounted to 270 tests / 13 files (duplicate history row removed, group-words + mesh-overlay rows added, Remaining Test Priorities row for both removed).
- **Adversarial PR review fixes** (PR #1): intent classification now sends `thinking: {type: "disabled"}` and joins the text blocks. Sonnet 5 runs adaptive thinking when `thinking` is omitted, so `content[0].text` would crash. It also falls back safely on `max_tokens`/`refusal`/non-object JSON. Docs corrected: authorization is partial (videos/processing check membership only), `requireMembership` is private, a human gate opens on ANY approved task, diarization isn't rendered, waveform `sample_rate` is the peak rate (200), only user labels are editable, and diarization's `token=` needs pyannote 4.x.
- **Known gap, not fixed here**: `ClassifyDialog.svelte` and `ContextMenu.svelte` are written but never mounted (`AnnotationViewer.svelte` declares `showClassifyDialog` and wires the `C` key to it, but never renders the dialog; `EditableDOMTrack`'s `onBlockContextMenu` prop has no caller). Left as-is — wiring vs. deleting is a product call, not a cleanup item.

### Files changed (cleanup)
- Modified: `workers/ml-pipeline/{stages/intent_classification.py,stages/diarization.py,modal_app.py,pyproject.toml,uv.lock,PIPELINE.md}`, `apps/web/{package.json,src/lib/components/viewer/state/history.test.ts}`, `pnpm-lock.yaml`, `.gitignore`, `reference/{07-facial-tracking-reference,cloud-infrastructure,getting-started,local-to-aws-migration,system-flow}.md`, `.claude/rules/{docs,testing}.md`, `CLAUDE.md`, `plans/INDEX.md`
- Deleted: `apps/web/src/lib/components/viewer/editing/history.test.ts`, `apps/web/src/lib/components/viewer/tracks/TrackRow.svelte`, `apps/web/src/lib/utils.ts`
- New: `apps/web/src/lib/components/viewer/{mesh-overlay.test.ts,utils/group-words.test.ts}`, `reference/02b-algorithm-reference-mouth-diarization-states.md`, `reference/02c-algorithm-reference-intents-summary.md`, `reference/02d-algorithm-reference-phase0-extras.md`
- Moved: `reference/{01-system-overview,03-data-flow,04-quick-start,05-cloud-deployment-guidance,06-typescript-cloud-port}.md` → `plans/archive/phase-0-reference/`; `reference/02-algorithm-reference.md` → `reference/02a-algorithm-reference-vad-transcription-face.md`; `plans/viewer-code-review.md` → `plans/archive/viewer-code-review.md`

---

## 2026-02-13 — Transcription LOD, Mesh Overlay + Depth, Vendored Face Mesh Topology (backfilled)

### Changes
- **Transcription LOD** (d558e86): `utils/group-words.ts` `groupWordsBySegment()` groups words by `speech_segment` into phrase blocks when zoomed out (avg word width < 8px). Cuts DOM elements from ~600 to ~40–60 at overview zoom. Also exports `MeshKeyframe`/`MeshTopology`/`DepthEstimationInfo` from the shared barrel.
- **Mesh overlay controls + depth types** (39b692f): opacity slider, video-dim toggle (V key), full-alpha wireframe colors; shared types for depth estimation + mesh topology; Depth Anything V2 in the facial_tracking Modal image.
- **Face mesh overlay + vendored topology** (fb0e158): new `MeshOverlay.svelte` + `mesh-overlay.ts`. MediaPipe 0.10.30+ removed `mediapipe.python.solutions`, so tessellation/contour/iris constants are vendored in `stages/face_mesh_topology.py` (Apache 2.0).

### Files changed
- New: `viewer/utils/group-words.ts`, `viewer/components/MeshOverlay.svelte`, `viewer/mesh-overlay.ts`, `workers/ml-pipeline/stages/face_mesh_topology.py`
- Modified: `AnnotationViewer.svelte`, `VideoPlayer.svelte`, `ViewerHeader.svelte`, `KeyboardShortcutsHelp.svelte`, `state/session.svelte.ts`, `viewer-palette.ts`, `packages/shared/src/{annotation-types,index}.ts`, `stages/facial_tracking.py`, `modal_app.py`, `pyproject.toml`, `uv.lock`

---
## 2026-02-13 — Viewer Bugfixes: Spacebar, Favicon 404s, SSR Warning

### Spacebar playing video natively
- **Root cause**: `<video>` element received spacebar keydown before the `<svelte:window>` handler could `preventDefault()`. Browser's native video play/pause fired alongside our custom `togglePlay()`.
- **Fix**: Added `tabindex="-1"` and `onkeydown={(e) => e.preventDefault()}` on `<video>` in `VideoPlayer.svelte` — removes it from tab order and blocks all native keyboard behavior on the element. Our window-level handler in `AnnotationViewer.svelte` remains the sole keyboard controller.

### Favicon / apple-touch-icon 404s
- **Root cause**: Only `favicon.svg` existed in `static/`. Browsers auto-request `/favicon.ico` by convention regardless of `<link>` tags. iOS requests `apple-touch-icon.png` and `apple-touch-icon-precomposed.png`.
- **Fix**: Created minimal `favicon.ico` (64 bytes) in `static/`. Added `<link rel="apple-touch-icon">` pointing to existing SVG in `app.html`.

### SSR fetch warning
- **Root cause**: `createSupabaseBrowserClient()` and `createTRPCClientInstance()` were initialized at component module level in `AnnotationViewer.svelte`. Supabase's browser client calls `fetch` during construction, triggering SvelteKit's SSR warning.
- **Fix**: Moved all three initializations (`supabase`, `trpc`, `dataLoader`) into `onMount()`, declared as `let` variables at module level.

### Files changed
- Modified: `VideoPlayer.svelte`, `AnnotationViewer.svelte`, `app.html`
- New: `static/favicon.ico`

---

## 2026-02-13 — Docs: Curator → Sidechain Rename + TalkVid Reference

### Changes
- Renamed all "Curator" references to "Sidechain" across `reference/` and `plans/archive/`
- Added `reference/talkvid-dataset.md` — dataset format, quality metrics, download instructions
- Added `talkvid-dataset.md` to `plans/INDEX.md`
- Added `data/` to `.gitignore` for downloaded samples
- New: `scripts/download-talkvid-sample.py`

---

## 2026-02-08 — Server-Side Waveform Peaks Pipeline Stage

### Motivation
Safari's `AudioContext.decodeAudioData()` cannot decode audio from video containers (MP4/MOV), causing silent waveform extraction failure. Moved waveform computation server-side as a new pipeline stage.

### New pipeline stage: `waveform`
- Root stage (no dependencies), runs in parallel with vad, transcription, facial_tracking
- Python stage (`stages/waveform.py`): ffmpeg extracts audio at 16kHz (preserves stereo), numpy computes peaks at 200 peaks/sec via windowed `max(abs)`
- Modal endpoint `process_waveform`: reuses `vad_image`, no GPU, 300s timeout
- Output: `waveform_peaks.json` (~50KB) with `peaks_l`, `peaks_r`, `sample_rate`, `max_peak`, `duration`

### Schema + types
- `WaveformPeaksResult` type in `@annotation/shared`
- `"waveform"` added to `PIPELINE_STAGES` and `pipelineStageEnum`
- Migration: `0003_eminent_tyger_tiger.sql` (`ALTER TYPE ADD VALUE 'waveform'`)

### DAG + trigger wiring
- `STAGE_DEPS.waveform = []`, `STAGE_RESULT_KEYS.waveform = "waveform_peaks.json"`
- `STAGE_FUNCTIONS.waveform = "process-waveform"` in trigger.ts

### Viewer changes
- Waveform loads from S3 via `getAllResults` like every other pipeline result
- `AnnotationDataState.waveform` + `waveformMax` replace session-level waveform fields
- Deleted client-side extraction: `extract-waveform.ts`, `waveform-cache.ts`, `waveform-cache.test.ts`

### Cleanup
- Removed legacy `process_vad` endpoint (superseded by `process_vad_stage`) to stay within Modal's 8-endpoint free tier

### Files changed
- New: `workers/ml-pipeline/stages/waveform.py`, `packages/db/drizzle/0003_eminent_tyger_tiger.sql`
- Modified: `modal_app.py`, `dag.ts`, `trigger.ts`, `annotation-data.svelte.ts`, `session.svelte.ts`, `data-loader.ts`, `AnnotationViewer.svelte`, `processing.ts`, `+page.svelte`, `dag.test.ts`, shared types + schema
- Deleted: `extract-waveform.ts`, `waveform-cache.ts`, `waveform-cache.test.ts`

---

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
