<script lang="ts">
  import type { createTRPCClientInstance } from "$lib/trpc";

  let {
    project,
    userRole,
    trpc,
    onUpdated,
    onDeleted,
  }: {
    project: {
      id: string;
      name: string;
      description: string | null;
      status: string;
    };
    userRole: string;
    trpc: ReturnType<typeof createTRPCClientInstance>;
    onUpdated: () => void;
    onDeleted: () => void;
  } = $props();

  const isAdmin = $derived(userRole === "admin");

  let name = $state("");
  let description = $state("");
  let status = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);
  let confirmingDelete = $state(false);
  let deleting = $state(false);

  // Sync form values from project prop
  $effect(() => {
    name = project.name;
    description = project.description ?? "";
    status = project.status;
  });

  async function save() {
    if (!name.trim()) return;
    saving = true;
    error = null;
    success = null;
    try {
      await trpc.projects.update.mutate({
        id: project.id,
        name: name.trim(),
        description: description.trim() || undefined,
        status: status as "active" | "paused" | "completed" | "archived",
      });
      success = "Project updated.";
      onUpdated();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to update project";
    } finally {
      saving = false;
    }
  }

  async function deleteProject() {
    deleting = true;
    error = null;
    try {
      await trpc.projects.delete.mutate({ id: project.id });
      onDeleted();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to delete project";
      deleting = false;
      confirmingDelete = false;
    }
  }
</script>

{#if !isAdmin}
  <div class="rounded-md border p-8 text-center text-muted-foreground">
    Only project admins can modify settings.
  </div>
{:else}
  <div class="max-w-lg space-y-6">
    {#if error}
      <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
    {/if}
    {#if success}
      <div class="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{success}</div>
    {/if}

    <div class="space-y-4">
      <div class="space-y-2">
        <label for="project-name" class="text-sm font-medium">Name</label>
        <input
          id="project-name"
          type="text"
          bind:value={name}
          class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div class="space-y-2">
        <label for="project-desc" class="text-sm font-medium">Description</label>
        <input
          id="project-desc"
          type="text"
          bind:value={description}
          placeholder="Brief description"
          class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div class="space-y-2">
        <label for="project-status" class="text-sm font-medium">Status</label>
        <select
          id="project-status"
          bind:value={status}
          class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <button
        onclick={save}
        disabled={saving || !name.trim()}
        class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
      >
        {saving ? "Saving..." : "Save changes"}
      </button>
    </div>

    <!-- Danger zone -->
    <div class="border-t pt-6">
      <h3 class="text-sm font-medium text-destructive">Danger zone</h3>
      <p class="mt-1 text-sm text-muted-foreground">
        Deleting a project removes all videos, pipeline results, annotations, and tasks permanently.
      </p>
      {#if !confirmingDelete}
        <button
          onclick={() => (confirmingDelete = true)}
          class="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-destructive px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          Delete project
        </button>
      {:else}
        <div class="mt-3 flex items-center gap-3">
          <button
            onclick={deleteProject}
            disabled={deleting}
            class="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Confirm delete"}
          </button>
          <button
            onclick={() => (confirmingDelete = false)}
            class="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
