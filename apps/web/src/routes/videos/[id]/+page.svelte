<script lang="ts">
  import { onMount } from "svelte";
  import type { PageData } from "./$types";
  import type { VideoStatus, PipelineStage, JobStatus } from "@annotation/shared";
  import { PIPELINE_STAGES } from "@annotation/shared";
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

  const jobStatusColors: Record<JobStatus, string> = {
    pending: "bg-gray-100 text-gray-800",
    running: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-500",
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

  function getJobForStage(stage: PipelineStage): ProcessingJob | undefined {
    return jobs.find((j) => j.stage === stage);
  }

  function areDepsCompleted(stage: PipelineStage): boolean {
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
      <h1 class="text-2xl font-semibold tracking-tight">{video.filename}</h1>
      <div class="flex items-center gap-4 text-sm text-muted-foreground">
        <span>Duration: {formatDuration(video.durationSecs)}</span>
        <span>Uploaded: {new Date(video.createdAt).toLocaleDateString()}</span>
        <span>Status: {video.status}</span>
      </div>
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
          {#if !allCompleted}
            <button
              onclick={processAll}
              disabled={processingAll || hasAnyRunning}
              class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {#if processingAll}
                Starting...
              {:else if hasAnyRunning}
                Processing...
              {:else if hasAnyFailed}
                Reprocess All
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
                <span class="text-xs text-muted-foreground">
                  {depsReady ? "Waiting to start" : "Blocked"}
                </span>
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
              {/if}
              {#if job?.status === "failed" && depsReady}
                <button
                  onclick={() => retryStage(stage)}
                  disabled={retryingStage !== null}
                  class="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {#if retryingStage === stage}
                    Retrying...
                  {:else}
                    Retry
                  {/if}
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
