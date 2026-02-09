<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { createTRPCClientInstance } from "$lib/trpc";
  import { createSupabaseBrowserClient } from "$lib/supabase";
  import { setActiveProject } from "$lib/stores/project.svelte";

  const supabase = createSupabaseBrowserClient();
  const trpc = createTRPCClientInstance(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  });

  interface ProjectRow {
    id: string;
    name: string;
    description: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    role: string;
  }

  let projects = $state<ProjectRow[]>([]);
  let loading = $state(true);
  let creating = $state(false);
  let newName = $state("");
  let newDescription = $state("");
  let error = $state<string | null>(null);

  const statusColors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    paused: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    completed: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    archived: "bg-muted text-muted-foreground",
  };

  async function loadProjects() {
    loading = true;
    try {
      projects = await trpc.projects.list.query();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load projects";
    } finally {
      loading = false;
    }
  }

  async function createProject() {
    if (!newName.trim()) return;
    error = null;
    try {
      const project = await trpc.projects.create.mutate({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      });
      newName = "";
      newDescription = "";
      creating = false;
      await loadProjects();
      goto(`/projects/${project.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to create project";
    }
  }

  function quickOpen(e: Event, id: string, name: string, role: string) {
    e.preventDefault();
    e.stopPropagation();
    setActiveProject(id, name, role);
    goto("/videos");
  }

  function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  onMount(() => {
    loadProjects();
  });
</script>

<svelte:head>
  <title>Projects — Sidechain</title>
</svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
      <p class="text-sm text-muted-foreground">
        Manage your annotation projects.
      </p>
    </div>
    <button
      onclick={() => (creating = !creating)}
      class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {creating ? "Cancel" : "New project"}
    </button>
  </div>

  {#if error}
    <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      {error}
    </div>
  {/if}

  {#if creating}
    <div class="rounded-md border bg-card p-6 space-y-4">
      <div class="space-y-2">
        <label for="project-name" class="text-sm font-medium">Name</label>
        <input
          id="project-name"
          type="text"
          bind:value={newName}
          placeholder="Project name"
          class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div class="space-y-2">
        <label for="project-desc" class="text-sm font-medium">Description (optional)</label>
        <input
          id="project-desc"
          type="text"
          bind:value={newDescription}
          placeholder="Brief description"
          class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <button
        onclick={createProject}
        disabled={!newName.trim()}
        class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
      >
        Create project
      </button>
    </div>
  {/if}

  {#if loading}
    <div class="rounded-md border p-8 text-center text-muted-foreground">
      Loading projects...
    </div>
  {:else if projects.length === 0}
    <div class="rounded-md border p-8 text-center text-muted-foreground">
      No projects yet. Create one to get started.
    </div>
  {:else}
    <div class="grid gap-3">
      {#each projects as project (project.id)}
        <a
          href="/projects/{project.id}"
          class="flex items-center justify-between rounded-md border p-4 text-left transition-colors hover:bg-muted/50 group"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="font-medium truncate">{project.name}</p>
              <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {statusColors[project.status] ?? 'bg-muted text-muted-foreground'}">
                {project.status}
              </span>
            </div>
            {#if project.description}
              <p class="text-sm text-muted-foreground mt-1 truncate">{project.description}</p>
            {/if}
            <p class="text-xs text-muted-foreground mt-1">Updated {formatDate(project.updatedAt)}</p>
          </div>
          <div class="flex items-center gap-3 ml-4">
            <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
              {project.role}
            </span>
            <button
              onclick={(e) => quickOpen(e, project.id, project.name, project.role)}
              title="Open videos"
              class="p-1.5 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground transition-all"
            >
              <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
