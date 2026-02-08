
  1. Build (no external deps)
  pnpm build --force

  2. Dev server + auth (needs Supabase)
  pnpm --filter web dev
  - Login/signup at /auth/login
  - Should redirect to /videos after auth

  3. Projects (needs DB)
  - After login, sidebar should show a project selector
  - First load auto-creates "My Project" via getOrCreateDefault
  - Visit /projects to create additional ones
  - Switching projects should clear/reload the video list

  4. Upload (needs S3 creds in .env)
  - Drag or select a video file on /videos
  - Progress bar should advance (real S3 multipart, not simulated)
  - Video appears in list with "uploaded" status after completion

  5. Pipeline trigger (needs Modal + tunnel)
  This is the big one. Requirements:
  - modal deploy workers/ml-pipeline/modal_app.py (deploys all 7 endpoints)
  - MODAL_BASE_URL in .env pointed at your Modal workspace
  - PUBLIC_APP_URL pointed at a tunnel (ngrok/cloudflare) so Modal can POST callbacks back
  - PROCESSING_CALLBACK_SECRET set in both .env and Modal secrets

  Then:
  - Open a video detail page → click "Process All"
  - 7 jobs should appear as pending
  - Root stages (vad, transcription, facial_tracking) fire immediately
  - Poll updates status badges every 5s
  - Dependent stages auto-trigger as prerequisites complete
  - "View results" shows JSON for completed stages
  - Failed stages show error + "Retry" button

  Without Modal, you can still verify the frontend logic:
  - Click "Process All" — should create 7 pending job rows in DB (will fail on the Modal POST, but the jobs get created first)
  - The error handling should show the failure message per stage
  - Retry button should appear on failed stages

  6. Callback chaining (if Modal is running)
  - Watch the DAG resolve: vad + transcription + facial_tracking start together
  - mouth_energy fires after facial_tracking completes
  - diarization fires after both vad + mouth_energy complete
  - state_annotation fires after diarization
  - intent_classification fires last (needs state_annotation + transcription + vad)
  - Video status flips to "ready" when all 7 complete

  The most practical smoke test without full infra: steps 1–4 verify the frontend wiring works. Step 5 onward needs Modal deployed.
