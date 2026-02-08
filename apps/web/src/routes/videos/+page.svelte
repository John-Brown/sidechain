<script lang="ts">
  import { onMount } from "svelte";
  import VideoUpload from "$lib/components/upload/VideoUpload.svelte";
  import { createTRPCClientInstance } from "$lib/trpc";
  import { createSupabaseBrowserClient } from "$lib/supabase";
  import { getActiveProject } from "$lib/stores/project.svelte";
  import type { VideoStatus } from "@annotation/shared";

  const supabase = createSupabaseBrowserClient();
  const trpc = createTRPCClientInstance(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  });

  const project = getActiveProject();

  interface VideoRow {
    id: string;
    filename: string;
    status: VideoStatus;
    durationSecs: number | null;
    createdAt: Date;
  }

  let videos = $state<VideoRow[]>([]);
  let showUpload = $state(false);
  let loading = $state(false);

  const statusColors: Record<VideoStatus, string> = {
    uploading: "bg-yellow-100 text-yellow-800",
    uploaded: "bg-cyan-100 text-cyan-800",
    processing: "bg-blue-100 text-blue-800",
    ready: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-800",
  };

  function formatDuration(secs: number | null): string {
    if (secs == null) return "--";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  async function loadVideos() {
    if (!project.id) return;
    loading = true;
    try {
      videos = await trpc.videos.list.query({ projectId: project.id });
    } catch {
      // Handle gracefully — may not have access yet
      videos = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (project.id) {
      loadVideos();
    }
  });
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Videos</h1>
      <p class="text-sm text-muted-foreground">
        Manage and process video files for annotation.
      </p>
    </div>
    {#if project.id}
      <button
        onclick={() => (showUpload = !showUpload)}
        class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {showUpload ? "Cancel" : "Upload video"}
      </button>
    {/if}
  </div>

  {#if !project.id}
    <div class="rounded-md border p-8 text-center text-muted-foreground">
      Select a project to view videos.
    </div>
  {:else}
    {#if showUpload}
      <VideoUpload
        projectId={project.id}
        onComplete={(videoId) => {
          showUpload = false;
          loadVideos();
        }}
      />
    {/if}

    <div class="rounded-md border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b bg-muted/50">
            <th class="px-4 py-3 text-left font-medium">Filename</th>
            <th class="px-4 py-3 text-left font-medium">Status</th>
            <th class="px-4 py-3 text-left font-medium">Duration</th>
            <th class="px-4 py-3 text-left font-medium">Uploaded</th>
            <th class="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#if loading}
            <tr>
              <td colspan="5" class="px-4 py-8 text-center text-muted-foreground">
                Loading videos...
              </td>
            </tr>
          {:else if videos.length === 0}
            <tr>
              <td colspan="5" class="px-4 py-8 text-center text-muted-foreground">
                No videos yet. Upload one to get started.
              </td>
            </tr>
          {:else}
            {#each videos as video (video.id)}
              <tr class="border-b transition-colors hover:bg-muted/50">
                <td class="px-4 py-3 font-medium">
                  <a href="/videos/{video.id}" class="hover:underline">
                    {video.filename}
                  </a>
                </td>
                <td class="px-4 py-3">
                  <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {statusColors[video.status]}">
                    {video.status}
                  </span>
                </td>
                <td class="px-4 py-3 text-muted-foreground">
                  {formatDuration(video.durationSecs)}
                </td>
                <td class="px-4 py-3 text-muted-foreground">
                  {new Date(video.createdAt).toLocaleDateString()}
                </td>
                <td class="px-4 py-3 text-right">
                  <a
                    href="/videos/{video.id}"
                    class="text-sm font-medium text-primary hover:underline"
                  >
                    View
                  </a>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</div>
