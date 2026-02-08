<script lang="ts">
  import type { PageData } from "./$types";
  import type { VideoStatus, PipelineStage, JobStatus } from "@annotation/shared";
  import { PIPELINE_STAGES } from "@annotation/shared";

  let { data }: { data: PageData } = $props();

  // TODO: Fetch video detail and processing jobs via tRPC
  interface VideoDetail {
    id: string;
    filename: string;
    status: VideoStatus;
    durationSecs: number | null;
    s3Key: string;
    createdAt: string;
  }

  interface ProcessingJob {
    id: string;
    stage: PipelineStage;
    status: JobStatus;
    progress: number;
    errorMessage: string | null;
    resultS3Key: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }

  let video = $state<VideoDetail | null>(null);
  let jobs = $state<ProcessingJob[]>([]);
  let runningStage = $state<PipelineStage | null>(null);
  let results = $state<Record<string, unknown> | null>(null);

  const jobStatusColors: Record<JobStatus, string> = {
    pending: "bg-gray-100 text-gray-800",
    running: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-500",
  };

  function getJobForStage(stage: PipelineStage): ProcessingJob | undefined {
    return jobs.find((j) => j.stage === stage);
  }

  async function triggerProcessing(stage: PipelineStage) {
    runningStage = stage;
    // TODO: Call tRPC to trigger processing for this stage
    // await trpc.processing.trigger.mutate({ videoId: data.videoId, stage });
    runningStage = null;
  }

  function formatDuration(secs: number | null): string {
    if (secs == null) return "Unknown";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
</script>

<div class="space-y-8">
  <div>
    <a href="/videos" class="text-sm text-muted-foreground hover:text-foreground transition-colors">
      &larr; Back to videos
    </a>
  </div>

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
      </div>
    </div>

    <!-- Processing Pipeline -->
    <div class="space-y-4">
      <h2 class="text-lg font-semibold">Processing Pipeline</h2>
      <div class="grid gap-3">
        {#each PIPELINE_STAGES as stage}
          {@const job = getJobForStage(stage)}
          <div class="flex items-center justify-between rounded-md border p-4">
            <div class="flex items-center gap-3">
              <span class="font-medium text-sm capitalize">
                {stage.replace("_", " ")}
              </span>
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
              {:else}
                <span class="text-xs text-muted-foreground">Not started</span>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              {#if job?.resultS3Key}
                <button
                  onclick={() => {
                    // TODO: Fetch results from tRPC
                    results = { stage, message: "Results would load here" };
                  }}
                  class="text-sm text-primary hover:underline"
                >
                  View results
                </button>
              {/if}
              {#if !job || job.status === "failed"}
                <button
                  onclick={() => triggerProcessing(stage)}
                  disabled={runningStage !== null}
                  class="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {runningStage === stage ? "Running..." : "Run"}
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
        <h2 class="text-lg font-semibold">Results</h2>
        <pre class="rounded-md border bg-muted p-4 text-xs overflow-auto max-h-96">{JSON.stringify(results, null, 2)}</pre>
      </div>
    {/if}
  {/if}
</div>
