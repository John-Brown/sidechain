# Phase 3: Annotation Viewer — QA Checklist

## Prerequisites

- A video uploaded and fully (or partially) processed through the pipeline
- `pnpm dev` running (`pnpm --filter web dev`)
- Supabase + S3 credentials configured in `.env`

---

## 1. Route & Navigation

- [ ] **Video detail page** (`/videos/{id}`) shows "Open Viewer" button when at least one stage is completed
- [ ] **Open Viewer** navigates to `/videos/{id}/viewer`
- [ ] **Viewer layout** renders full-viewport (no sidebar, no padding, dark theme)
- [ ] **Back button** in viewer header returns to `/videos/{id}` detail page
- [ ] **Auth guard**: visiting `/videos/{id}/viewer` while logged out redirects to `/auth/login`
- [ ] **Sidebar suppression**: confirm the main app sidebar is NOT visible on the viewer route

## 2. Video Playback

- [ ] **Video loads** from presigned S3 URL (video appears in left panel)
- [ ] **Play/pause** button in header works
- [ ] **Duration** populates correctly in the header time display (MM:SS.fff / MM:SS.fff)
- [ ] **Time display** updates at frame rate during playback (smooth, not choppy)
- [ ] **Video fills** left panel without overflow; aspect ratio preserved

## 3. Timeline Ruler

- [ ] **Ruler track** (top track, 32px) renders time ticks
- [ ] **Tick density** adapts to zoom: at low zoom shows 10s/50s intervals, at high zoom shows 1s/5s
- [ ] **Major ticks** labeled with MM:SS format
- [ ] **Ruler spans** the full video duration

## 4. Canvas Tracks (VAD, Energy, Diarization, Mouth Energy)

For each canvas track that has data:

- [ ] **VAD**: Indigo bars showing speech probability, red dashed threshold line at 0.5
- [ ] **Energy**: Dual-channel — cyan bars above center (left), pink bars below (right), center line visible
- [ ] **Diarization**: Speaker-colored blocks (cyan for SPEAKER_00, pink for SPEAKER_01), labeled when wide enough
- [ ] **Mouth Energy**: Green line chart

For tracks without data:
- [ ] Shows "Loading..." or "Error" status text (not blank/broken)

## 5. DOM Tracks (Transcription, States, Intents)

- [ ] **Transcription**: Word-level blocks colored by speaker (cyan=SPEAKER_00, pink=SPEAKER_01)
- [ ] **States**: Blocks colored green (speaking) / gray (listening)
- [ ] **Intents**: Blocks with 6 intent colors (indigo/cyan/amber/red/violet/emerald)
- [ ] **Block labels** visible when blocks are wide enough (zoom in)
- [ ] **Click a block** → InspectorPanel (bottom-left) shows annotation details

## 6. Playhead

- [ ] **Red vertical line** visible, positioned at current playback time
- [ ] **Moves smoothly** during playback (not steppy)
- [ ] **Stays within** visible viewport during auto-scroll

## 7. Scrub-to-Seek

- [ ] **Click** on ruler → video seeks to that time
- [ ] **Click** on any canvas track → video seeks to that time
- [ ] **Drag** on ruler/canvas tracks → video scrubs continuously (pointer capture)
- [ ] **Release** ends scrubbing

## 8. Zoom

- [ ] **Zoom slider** in header (0.5x to 20x) changes timeline zoom
- [ ] **Cmd/Ctrl + scroll wheel** on timeline area zooms in/out
- [ ] Zooming **preserves approximate scroll position** (doesn't jump to start)
- [ ] At high zoom, individual VAD segments and word blocks are clearly visible
- [ ] At low zoom, full video duration visible in viewport

## 9. Scroll & Auto-Scroll

- [ ] **Horizontal scroll** on timeline area scrolls all tracks together
- [ ] **Playhead tracks** current time; when it exits the right edge, timeline auto-scrolls to keep it visible (~100px from left)
- [ ] **Vertical scroll** works when more tracks than viewport height
- [ ] Custom **scrollbar styling** (dark theme, not default browser chrome)

## 10. Keyboard Shortcuts

- [ ] **Space**: play/pause toggle
- [ ] **Left arrow**: seek back 1 second
- [ ] **Right arrow**: seek forward 1 second
- [ ] **Shift+Left**: seek back 5 seconds
- [ ] **Shift+Right**: seek forward 5 seconds
- [ ] **Home**: seek to start (0:00)
- [ ] **End**: seek to end
- [ ] Shortcuts **don't fire** when focus is on the zoom slider input

## 11. Inspector Panel

- [ ] Located below the video player (bottom-left)
- [ ] Default state: "Click an annotation to inspect"
- [ ] After clicking a DOM block: shows all properties of that annotation
- [ ] **time_range** displayed as formatted timestamps (not raw numbers)
- [ ] **Nested objects** rendered as formatted JSON

## 12. Incremental Loading

- [ ] Open viewer for a video **still processing** — tracks show "Loading..." for in-progress stages
- [ ] As stages complete (wait or manually trigger), tracks **appear without page reload** (5s poll)
- [ ] Error states from failed stages displayed

## 13. Performance (with fully processed video)

Open Chrome DevTools → Performance tab:

- [ ] **Record** 5 seconds of playback with all tracks visible
- [ ] **p95 frame time** < 16ms (60fps target)
- [ ] **No layout thrashing** — canvas tracks use will-change, DOM blocks use contain:layout
- [ ] Zoom out fully → **inspect DOM**: only visible blocks rendered (not all 300+)
- [ ] **No memory leaks**: play/pause several times, check heap doesn't grow

## 14. Build

- [ ] `pnpm build` passes clean (adapter-auto warning is expected)
- [ ] No TypeScript errors from `pnpm --filter web check` (if applicable)

---

## Known Limitations (Expected in Phase 3)

- **Read-only**: no drag/resize handles on blocks (Phase 4)
- **No waveform track**: spike had waveform rendering from audio decode; not included here
- **Facial tracking excluded**: too large (~15MB) for batch fetch, deferred to Phase 4
- **No track show/hide toggles**: all tracks always visible
- **No minimap/overview**: full zoom-out is the only "overview" mode
