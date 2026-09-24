<script lang="ts">
  import "../app.css";
  import { goto, invalidateAll } from "$app/navigation";
  import { onMount } from "svelte";
  import { createSupabaseBrowserClient } from "$lib/supabase";
  import { createTRPCClientInstance } from "$lib/trpc";
  import { getActiveProject, setActiveProject } from "$lib/stores/project.svelte";
  import { page } from "$app/state";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";

  let { children, data } = $props();

  const supabase = createSupabaseBrowserClient();
  const trpc = createTRPCClientInstance(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  });

  const project = getActiveProject();

  interface ProjectItem {
    id: string;
    name: string;
    role: string;
  }

  let projectList = $state<ProjectItem[]>([]);
  let projectsOpen = $state(false);

  onMount(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      if (session?.expires_at !== data.session?.expires_at) {
        invalidateAll();
      }
    });

    if (data.session) {
      loadProjects();
    }

    return () => subscription.unsubscribe();
  });

  async function loadProjects() {
    try {
      const list = await trpc.projects.list.query();
      projectList = list.map((p) => ({ id: p.id, name: p.name, role: p.role }));
      if (!project.id && projectList.length > 0) {
        setActiveProject(projectList[0].id, projectList[0].name, projectList[0].role);
      } else if (!project.id && projectList.length === 0) {
        const defaultProject = await trpc.projects.getOrCreateDefault.mutate();
        setActiveProject(defaultProject.id, defaultProject.name, "admin");
        projectList = [{ id: defaultProject.id, name: defaultProject.name, role: "admin" }];
      }
    } catch {
      // Auth may not be ready yet — silently ignore
    }
  }

  function selectProject(p: ProjectItem) {
    setActiveProject(p.id, p.name, p.role);
    projectsOpen = false;
  }

  const isAuthRoute = $derived(page.url.pathname.startsWith("/auth"));
  /** Full-screen viewer routes: no app shell, no floating theme toggle (the viewer header has one) */
  const isTimelineRoute = $derived(
    page.url.pathname.includes("/timeline") || page.url.pathname.startsWith("/dev/viewer"),
  );

  async function signOut() {
    await supabase.auth.signOut();
    goto("/auth/login");
  }
</script>

{#if isTimelineRoute}
  <div class="h-screen w-screen overflow-hidden">
    {@render children()}
  </div>
{:else if isAuthRoute || !data.session}
  <main class="min-h-screen flex items-center justify-center bg-muted/40">
    <div class="fixed top-4 right-4">
      <ThemeToggle />
    </div>
    {@render children()}
  </main>
{:else}
  <div class="flex min-h-screen">
    <aside class="w-64 border-r bg-sidebar text-sidebar-foreground flex flex-col">
      <div class="p-6 border-b">
        <h1 class="text-lg font-semibold tracking-tight">Sidechain</h1>
      </div>

      <!-- Project selector -->
      <div class="px-4 pt-4 pb-2">
        <div class="relative">
          <button
            onclick={() => (projectsOpen = !projectsOpen)}
            class="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
          >
            <span class="truncate">{project.name ?? "Select project"}</span>
            <svg class="h-4 w-4 shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          {#if projectsOpen}
            <div class="absolute z-50 mt-1 w-full rounded-md border bg-popover">
              {#each projectList as p (p.id)}
                <button
                  onclick={() => selectProject(p)}
                  class="flex w-full items-center px-3 py-2 text-sm transition-colors hover:bg-accent {p.id === project.id ? 'bg-accent/50 font-medium' : ''}"
                >
                  {p.name}
                </button>
              {/each}
              <a
                href="/projects"
                onclick={() => (projectsOpen = false)}
                class="flex w-full items-center border-t px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Manage projects
              </a>
            </div>
          {/if}
        </div>
      </div>

      <nav class="flex-1 p-4 space-y-1">
        <a
          href="/videos"
          class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          class:bg-sidebar-accent={page.url.pathname.startsWith("/videos")}
        >
          <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
          Videos
        </a>
        <a
          href="/projects"
          class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          class:bg-sidebar-accent={page.url.pathname.startsWith("/projects")}
        >
          <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
          Projects
        </a>
      </nav>
      <div class="p-4 border-t space-y-2">
        <span class="block text-sm text-muted-foreground truncate">
          {data.user?.email ?? ""}
        </span>
        <div class="flex items-center justify-between">
          <ThemeToggle />
          <button
            onclick={signOut}
            class="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
    <main class="flex-1 p-8">
      {@render children()}
    </main>
  </div>
{/if}
