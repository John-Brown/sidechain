<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import type { createTRPCClientInstance } from "$lib/trpc";

  let {
    projectId,
    userRole,
    trpc,
  }: {
    projectId: string;
    userRole: string;
    trpc: ReturnType<typeof createTRPCClientInstance>;
  } = $props();

  let dashboard = $state<{
    videoCount: number;
    videosByStatus: Record<string, number>;
    jobsByStatus: Record<string, number>;
    tasksByStatus: Record<string, number>;
    recentVideos: { id: string; filename: string; status: string; createdAt: Date }[];
  } | null>(null);
  let loading = $state(true);

  async function loadDashboard() {
    loading = true;
    try {
      dashboard = await trpc.projects.dashboard.query({ projectId });
    } catch {
      // Silently handle — shows empty state
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadDashboard();
  });

  const statusColors: Record<string, string> = {
    uploading: "text-amber-600 dark:text-amber-400",
    uploaded: "text-blue-600 dark:text-blue-400",
    processing: "text-indigo-600 dark:text-indigo-400",
    ready: "text-emerald-600 dark:text-emerald-400",
    error: "text-destructive",
  };
</script>

{#if loading}
  <div class="rounded-md border p-8 text-center text-muted-foreground">
    Loading dashboard...
  </div>
{:else if dashboard}
  <!-- Stats grid -->
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <div class="rounded-md border bg-card p-4">
      <p class="text-sm text-muted-foreground">Videos</p>
      <p class="text-2xl font-semibold tracking-tight">{dashboard.videoCount}</p>
    </div>
    <div class="rounded-md border bg-card p-4">
      <p class="text-sm text-muted-foreground">Ready</p>
      <p class="text-2xl font-semibold tracking-tight">{dashboard.videosByStatus.ready ?? 0}</p>
    </div>
    <div class="rounded-md border bg-card p-4">
      <p class="text-sm text-muted-foreground">Jobs running</p>
      <p class="text-2xl font-semibold tracking-tight">{dashboard.jobsByStatus.running ?? 0}</p>
    </div>
    <div class="rounded-md border bg-card p-4">
      <p class="text-sm text-muted-foreground">Tasks pending</p>
      <p class="text-2xl font-semibold tracking-tight">
        {(dashboard.tasksByStatus.pending ?? 0) + (dashboard.tasksByStatus.assigned ?? 0) + (dashboard.tasksByStatus.in_progress ?? 0)}
      </p>
    </div>
  </div>

  <!-- Pipeline health -->
  {#if Object.keys(dashboard.jobsByStatus).length > 0}
    <div class="mt-6">
      <h2 class="text-lg font-semibold mb-3">Pipeline</h2>
      <div class="flex flex-wrap gap-3">
        {#each Object.entries(dashboard.jobsByStatus) as [status, n] (status)}
          <div class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
            <span class="h-2 w-2 rounded-full {status === 'completed' ? 'bg-emerald-500' : status === 'running' ? 'bg-indigo-500' : status === 'failed' ? 'bg-red-500' : 'bg-muted-foreground'}"></span>
            {status}: {n}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Recent videos -->
  {#if dashboard.recentVideos.length > 0}
    <div class="mt-6">
      <h2 class="text-lg font-semibold mb-3">Recent videos</h2>
      <div class="rounded-md border divide-y">
        {#each dashboard.recentVideos as video (video.id)}
          <button
            onclick={() => goto(`/videos/${video.id}`)}
            class="flex w-full items-center justify-between px-4 py-3 text-sm text-left transition-colors hover:bg-muted/50"
          >
            <span class="truncate font-medium">{video.filename}</span>
            <span class="text-xs {statusColors[video.status] ?? 'text-muted-foreground'}">{video.status}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
{:else}
  <div class="rounded-md border p-8 text-center text-muted-foreground">
    No data available yet.
  </div>
{/if}
