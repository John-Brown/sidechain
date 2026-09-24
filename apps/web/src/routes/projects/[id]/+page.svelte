<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { createTRPCClientInstance } from "$lib/trpc";
  import { createSupabaseBrowserClient } from "$lib/supabase";
  import { setActiveProject } from "$lib/stores/project.svelte";
  import ProjectOverview from "$lib/components/project/ProjectOverview.svelte";
  import ProjectSettings from "$lib/components/project/ProjectSettings.svelte";
  import ProjectMembers from "$lib/components/project/ProjectMembers.svelte";
  import ProjectGuidelines from "$lib/components/project/ProjectGuidelines.svelte";

  let { data } = $props();

  const supabase = createSupabaseBrowserClient();
  const trpc = createTRPCClientInstance(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  });

  type Tab = "overview" | "settings" | "members" | "guidelines";
  const TABS: { value: Tab; label: string }[] = [
    { value: "overview", label: "Overview" },
    { value: "settings", label: "Settings" },
    { value: "members", label: "Members" },
    { value: "guidelines", label: "Guidelines" },
  ];

  let activeTab = $state<Tab>("overview");
  let project = $state<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    guidelines: string | null;
    guidelinesUpdatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    role: string;
  } | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  function readTabFromUrl() {
    const tab = page.url.searchParams.get("tab");
    if (tab && TABS.some((t) => t.value === tab)) {
      activeTab = tab as Tab;
    }
  }

  function switchTab(tab: Tab) {
    activeTab = tab;
    const url = new URL(page.url);
    if (tab === "overview") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    goto(url.toString(), { replaceState: true, noScroll: true });
  }

  async function loadProject() {
    loading = true;
    error = null;
    try {
      project = await trpc.projects.get.query({ id: data.projectId });
      setActiveProject(project.id, project.name, project.role);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load project";
    } finally {
      loading = false;
    }
  }

  function handleProjectUpdated() {
    loadProject();
  }

  function handleProjectDeleted() {
    goto("/projects");
  }

  onMount(() => {
    readTabFromUrl();
    loadProject();
  });
</script>

<svelte:head>
  <title>{project?.name ?? "Project"} — Sidechain</title>
</svelte:head>

<div class="space-y-6">
  {#if loading}
    <div class="rounded-md border p-8 text-center text-muted-foreground">
      Loading project...
    </div>
  {:else if error}
    <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      {error}
    </div>
  {:else if project}
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <a
          href="/projects"
          class="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to projects"
        >
          <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </a>
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">{project.name}</h1>
          {#if project.description}
            <p class="text-sm text-muted-foreground">{project.description}</p>
          {/if}
        </div>
        <span class="inline-flex items-center rounded-sm px-2.5 py-0.5 text-xs font-medium {project.status === 'active' ? 'bg-primary/10 text-primary' : project.status === 'paused' ? 'bg-muted text-muted-foreground' : project.status === 'archived' ? 'bg-muted text-muted-foreground' : 'bg-secondary text-secondary-foreground'}">
          {project.status}
        </span>
      </div>
    </div>

    <!-- Tabs -->
    <div class="border-b">
      <nav class="flex gap-4" aria-label="Project tabs">
        {#each TABS as tab (tab.value)}
          <button
            onclick={() => switchTab(tab.value)}
            class="relative px-1 pb-3 text-sm font-medium transition-colors {activeTab === tab.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
          >
            {tab.label}
            {#if activeTab === tab.value}
              <span class="absolute inset-x-0 bottom-0 h-0.5 bg-primary"></span>
            {/if}
          </button>
        {/each}
      </nav>
    </div>

    <!-- Tab content -->
    <div>
      {#if activeTab === "overview"}
        <ProjectOverview projectId={project.id} userRole={project.role} {trpc} />
      {:else if activeTab === "settings"}
        <ProjectSettings {project} userRole={project.role} {trpc} onUpdated={handleProjectUpdated} onDeleted={handleProjectDeleted} />
      {:else if activeTab === "members"}
        <ProjectMembers projectId={project.id} userRole={project.role} {trpc} />
      {:else if activeTab === "guidelines"}
        <ProjectGuidelines
          projectId={project.id}
          userRole={project.role}
          guidelines={project.guidelines}
          updatedAt={project.guidelinesUpdatedAt}
          {trpc}
          onUpdated={handleProjectUpdated}
        />
      {/if}
    </div>
  {/if}
</div>
