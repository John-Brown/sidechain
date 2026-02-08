<script lang="ts">
  import { onMount } from "svelte";
  import type { PageData } from "./$types";
  import type { VideoStatus, PipelineStage, JobStatus, VideoMetadata, VideoLanguage } from "@annotation/shared";
  import { PIPELINE_STAGES, VIDEO_LANGUAGES } from "@annotation/shared";
  import { createTRPCClientInstance } from "$lib/trpc";
  import { createSupabaseBrowserClient } from "$lib/supabase";

  let { data }: { data: PageData } = $props();

  const supabase = createSupabaseBrowserClient();
  const trpc = createTRPCClientInstance(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  });

  interface VideoDetail {
    id: string;
    filename: string;
    status: VideoStatus;
    durationSecs: number | null;
    s3Key: string;
    createdAt: Date;
    uploadMetadata: VideoMetadata | null;
  }

  interface ProcessingJob {
    id: string;
    stage: PipelineStage;
    status: JobStatus;
    progress: number;
    errorMessage: string | null;
    resultS3Key: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }

  let video = $state<VideoDetail | null>(null);
  let jobs = $state<ProcessingJob[]>([]);
  let processingAll = $state(false);
  let retryingStage = $state<PipelineStage | null>(null);
  let results = $state<Record<string, unknown> | null>(null);
  let resultsStage = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let pollTimer = $state<ReturnType<typeof setInterval> | null>(null);

  // Metadata editing state
  let editing = $state(false);
  let saving = $state(false);
  let editFilename = $state("");
  let editDescription = $state("");
  let editTags = $state<string[]>([]);
  let editTagInput = $state("");
  let editSpeakerCount = $state<number | undefined>(undefined);
  let editLanguage = $state<VideoLanguage | "">("");

  function startEditing() {
    if (!video) return;
    const meta = video.uploadMetadata;
    editFilename = video.filename;
    editDescription = meta?.description ?? "";
    editTags = meta?.tags ? [...meta.tags] : [];
    editTagInput = "";
    editSpeakerCount = meta?.speakerCount;
    editLanguage = meta?.language ?? "";
    editing = true;
  }

  function cancelEditing() {
    editing = false;
  }

  function addTag() {
    const tag = editTagInput.trim();
    if (tag && !editTags.includes(tag)) {
      editTags = [...editTags, tag];
    }
    editTagInput = "";
  }

  function removeTag(tag: string) {
    editTags = editTags.filter((t) => t !== tag);
  }

  function handleTagKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  }

  async function saveMetadata() {
    if (!video) return;
    saving = true;
    loadError = null;
    try {
      const metadata: VideoMetadata = {};
      if (editDescription.trim()) metadata.description = editDescription.trim();
      if (editTags.length > 0) metadata.tags = editTags;
      if (editSpeakerCount !== undefined) metadata.speakerCount = editSpeakerCount;
      if (editLanguage) metadata.language = editLanguage as VideoLanguage;

      await trpc.videos.update.mutate({
        id: video.id,
        filename: editFilename.trim() || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      editing = false;
      await loadVideo();
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Failed to save metadata";
    } finally {
      saving = false;
    }
  }

  const jobStatusColors: Record<JobStatus, string> = {
    pending: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-900/30 dark:text-gray-500",
  };

  const STAGE_DEPS: Record<PipelineStage, PipelineStage[]> = {
    vad: [],
    transcription: [],
    facial_tracking: [],
    mouth_energy: ["facial_tracking"],
    diarization: ["vad", "mouth_energy"],
    state_annotation: ["diarization"],
    intent_classification: ["state_annotation", "transcription", "vad"],
  };

  // All stages enabled as of 2026-02-08
  const IN_DEVELOPMENT: Set<PipelineStage> = new Set([]);

  function getJobForStage(stage: PipelineStage): ProcessingJob | undefined {
    return jobs.find((j) => j.stage === stage);
  }

  function areDepsCompleted(stage: PipelineStage): boolean {
    if (IN_DEVELOPMENT.has(stage)) return false;
    return STAGE_DEPS[stage].every((dep) => {
      const job = getJobForStage(dep);
      return job?.status === "completed";
    });
  }

  let completedCount = $derived(
    PIPELINE_STAGES.filter(
      (s) => getJobForStage(s)?.status === "completed",
    ).length,
  );

  let hasAnyRunning = $derived(
    jobs.some((j) => j.status === "running" || j.status === "pending"),
  );

  let hasAnyFailed = $derived(jobs.some((j) => j.status === "failed"));

  let allCompleted = $derived(
    PIPELINE_STAGES.every((s) => getJobForStage(s)?.status === "completed"),
  );

  let hasStartedPipeline = $derived(jobs.length > 0);

  async function loadVideo() {
    try {
      const result = await trpc.videos.get.query({ id: data.videoId });
      video = result;
      jobs = result.processingJobs;
      startPollingIfNeeded();
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Failed to load video";
    }
  }

  async function pollJobs() {
    try {
      const updatedJobs = await trpc.processing.getJobStatus.query({
        videoId: data.videoId,
      });
      jobs = updatedJobs;

      const hasActive = updatedJobs.some(
        (j) => j.status === "running" || j.status === "pending",
      );
      if (!hasActive) {
        stopPolling();
      }
    } catch {
      // Silently ignore poll errors
    }
  }

  function startPollingIfNeeded() {
    const hasActive = jobs.some(
      (j) => j.status === "running" || j.status === "pending",
    );
    if (hasActive && !pollTimer) {
      pollTimer = setInterval(pollJobs, 5000);
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function processAll() {
    processingAll = true;
    loadError = null;
    try {
      await trpc.processing.triggerPipeline.mutate({
        videoId: data.videoId,
      });
      await pollJobs();
      startPollingIfNeeded();
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Failed to trigger pipeline";
    } finally {
      processingAll = false;
    }
  }

  async function retryStage(stage: PipelineStage) {
    retryingStage = stage;
    loadError = null;
    try {
      await trpc.processing.retryStage.mutate({
        videoId: data.videoId,
        stage,
      });
      await pollJobs();
      startPollingIfNeeded();
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Failed to retry stage";
    } finally {
      retryingStage = null;
    }
  }

  async function viewResults(stage: PipelineStage) {
    try {
      const data_ = await trpc.processing.getResults.query({
        videoId: data.videoId,
        stage,
      });
      results = data_ as Record<string, unknown>;
      resultsStage = stage;
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Failed to load results";
    }
  }

  function formatDuration(secs: number | null): string {
    if (secs == null) return "Unknown";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  onMount(() => {
    loadVideo();
    return () => stopPolling();
  });
</script>

<svelte:head>
  <title>{video?.filename ?? 'Video'} — Sidechain</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <a href="/videos" class="text-sm text-muted-foreground hover:text-foreground transition-colors">
      &larr; Back to videos
    </a>
  </div>

  {#if loadError}
    <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      {loadError}
    </div>
  {/if}

  {#if !video}
    <div class="rounded-md border p-8 text-center text-muted-foreground">
      Loading video details...
      <p class="mt-2 text-xs">Video ID: {data.videoId}</p>
    </div>
  {:else}
    <div class="space-y-2">
      <div class="flex items-center gap-4">
        <h1 class="text-2xl font-semibold tracking-tight">{video.filename}</h1>
        {#if completedCount > 0}
          <a
            href="/videos/{data.videoId}/timeline"
            class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open Timeline
          </a>
        {/if}
      </div>
      <div class="flex items-center gap-4 text-sm text-muted-foreground">
        <span>Duration: {formatDuration(video.durationSecs)}</span>
        <span>Uploaded: {new Date(video.createdAt).toLocaleDateString()}</span>
        <span>Status: {video.status}</span>
      </div>
    </div>

    <!-- Metadata -->
    <div class="space-y-3 rounded-md border p-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Metadata</h2>
        {#if !editing}
          <button
            onclick={startEditing}
            class="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted"
          >
            Edit
          </button>
        {/if}
      </div>

      {#if editing}
        <div class="space-y-4">
          <div class="space-y-1">
            <label for="edit-filename" class="text-sm font-medium">Filename</label>
            <input
              id="edit-filename"
              type="text"
              bind:value={editFilename}
              class="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div class="space-y-1">
            <label for="edit-description" class="text-sm font-medium">Description</label>
            <textarea
              id="edit-description"
              bind:value={editDescription}
              rows={3}
              class="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
              placeholder="Add a description..."
            ></textarea>
          </div>

          <div class="space-y-1">
            <label for="edit-tags" class="text-sm font-medium">Tags</label>
            <div class="flex flex-wrap gap-1.5 mb-1.5">
              {#each editTags as tag}
                <span class="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                  {tag}
                  <button
                    onclick={() => removeTag(tag)}
                    class="ml-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Remove tag {tag}"
                  >&times;</button>
                </span>
              {/each}
            </div>
            <input
              id="edit-tags"
              type="text"
              bind:value={editTagInput}
              onkeydown={handleTagKeydown}
              placeholder="Type a tag and press Enter"
              class="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <label for="edit-speakers" class="text-sm font-medium">Speaker count</label>
              <input
                id="edit-speakers"
                type="number"
                min="1"
                max="100"
                bind:value={editSpeakerCount}
                placeholder="e.g. 2"
                class="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div class="space-y-1">
              <label for="edit-language" class="text-sm font-medium">Language</label>
              <select
                id="edit-language"
                bind:value={editLanguage}
                class="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Not set</option>
                {#each VIDEO_LANGUAGES as lang}
                  <option value={lang}>{lang}</option>
                {/each}
              </select>
            </div>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <button
              onclick={saveMetadata}
              disabled={saving}
              class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onclick={cancelEditing}
              disabled={saving}
              class="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      {:else}
        {@const meta = video.uploadMetadata}
        {#if meta && (meta.description || meta.tags?.length || meta.speakerCount || meta.language)}
          <div class="space-y-2 text-sm">
            {#if meta.description}
              <p class="text-muted-foreground whitespace-pre-wrap">{meta.description}</p>
            {/if}
            {#if meta.tags?.length}
              <div class="flex flex-wrap gap-1.5">
                {#each meta.tags as tag}
                  <span class="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{tag}</span>
                {/each}
              </div>
            {/if}
            <div class="flex items-center gap-4 text-muted-foreground">
              {#if meta.speakerCount}
                <span>Speakers: {meta.speakerCount}</span>
              {/if}
              {#if meta.language}
                <span>Language: {meta.language}</span>
              {/if}
            </div>
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">No metadata set.</p>
        {/if}
      {/if}
    </div>

    <!-- Processing Pipeline -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Processing Pipeline</h2>
        <div class="flex items-center gap-3">
          {#if hasStartedPipeline}
            <span class="text-sm text-muted-foreground">
              {completedCount}/{PIPELINE_STAGES.length} stages completed
            </span>
          {/if}
          <button
            onclick={pollJobs}
            class="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted"
          >
            Refresh
          </button>
          {#if !allCompleted}
            <button
              onclick={processAll}
              disabled={processingAll}
              class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {#if processingAll}
                Starting...
              {:else if hasStartedPipeline}
                Reprocess
              {:else}
                Process All
              {/if}
            </button>
          {/if}
        </div>
      </div>

      <div class="grid gap-3">
        {#each PIPELINE_STAGES as stage}
          {@const job = getJobForStage(stage)}
          {@const deps = STAGE_DEPS[stage]}
          {@const depsReady = areDepsCompleted(stage)}
          <div class="flex items-center justify-between rounded-md border p-4">
            <div class="flex items-center gap-3">
              <span class="font-medium text-sm capitalize">
                {stage.replace(/_/g, " ")}
              </span>
              {#if deps.length > 0}
                <span class="text-xs text-muted-foreground">
                  (needs: {deps.map((d) => d.replace(/_/g, " ")).join(", ")})
                </span>
              {/if}
              {#if job}
                <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {jobStatusColors[job.status]}">
                  {job.status}
                </span>
                {#if job.status === "running"}
                  <div class="w-24 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      class="h-full bg-primary transition-all"
                      style="width: {job.progress * 100}%"
                    ></div>
                  </div>
                {/if}
                {#if job.status === "failed" && job.errorMessage}
                  <span class="text-xs text-destructive truncate max-w-xs" title={job.errorMessage}>
                    {job.errorMessage}
                  </span>
                {/if}
              {:else}
                {#if IN_DEVELOPMENT.has(stage)}
                  <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                    In development
                  </span>
                {:else if !depsReady}
                  <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Awaiting dependencies
                  </span>
                {:else}
                  <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
                    Ready
                  </span>
                {/if}
              {/if}
            </div>
            <div class="flex items-center gap-2">
              {#if job?.status === "completed" && job.resultS3Key}
                <button
                  onclick={() => viewResults(stage)}
                  class="text-sm text-primary hover:underline"
                >
                  View results
                </button>
                <button
                  onclick={() => retryStage(stage)}
                  disabled={retryingStage !== null}
                  class="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
                >
                  {retryingStage === stage ? "Starting..." : "Rerun"}
                </button>
              {/if}
              {#if job?.status === "failed" && depsReady}
                <button
                  onclick={() => retryStage(stage)}
                  disabled={retryingStage !== null}
                  class="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {retryingStage === stage ? "Retrying..." : "Retry"}
                </button>
              {/if}
              {#if !job && depsReady && !IN_DEVELOPMENT.has(stage)}
                <button
                  onclick={() => retryStage(stage)}
                  disabled={retryingStage !== null}
                  class="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
                >
                  {retryingStage === stage ? "Starting..." : "Run"}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Results -->
    {#if results}
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            Results{resultsStage ? ` — ${resultsStage.replace(/_/g, " ")}` : ""}
          </h2>
          <button
            onclick={() => { results = null; resultsStage = null; }}
            class="text-sm text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>
        <pre class="rounded-md border bg-muted p-4 text-xs overflow-auto max-h-96">{JSON.stringify(results, null, 2)}</pre>
      </div>
    {/if}
  {/if}
</div>
