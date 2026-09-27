<script lang="ts">
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import type { createTRPCClientInstance } from "$lib/trpc";

  let {
    projectId,
    userRole,
    guidelines,
    updatedAt,
    trpc,
    onUpdated,
  }: {
    projectId: string;
    userRole: string;
    guidelines: string | null;
    updatedAt: Date | null;
    trpc: ReturnType<typeof createTRPCClientInstance>;
    onUpdated: () => void;
  } = $props();

  const canEdit = $derived(userRole === "admin" || userRole === "supervisor");

  let editing = $state(false);
  let draft = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);
  let preview = $state(false);

  // Sync draft from guidelines prop when not editing
  $effect(() => {
    if (!editing) {
      draft = guidelines ?? "";
    }
  });

  function startEditing() {
    draft = guidelines ?? "";
    editing = true;
    preview = false;
  }

  function cancelEditing() {
    editing = false;
    error = null;
  }

  async function save() {
    saving = true;
    error = null;
    try {
      await trpc.projects.updateGuidelines.mutate({
        projectId,
        guidelines: draft,
      });
      editing = false;
      onUpdated();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save guidelines";
    } finally {
      saving = false;
    }
  }

  function renderMarkdown(text: string): string {
    const raw = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }
</script>

<div class="space-y-4">
  {#if error}
    <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
  {/if}

  <div class="flex items-center justify-between">
    <div>
      {#if updatedAt}
        <p class="text-xs text-muted-foreground">
          Last updated {new Date(updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </p>
      {/if}
    </div>
    {#if canEdit && !editing}
      <button
        onclick={startEditing}
        class="inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted"
      >
        {guidelines ? "Edit" : "Add guidelines"}
      </button>
    {/if}
  </div>

  {#if editing}
    <!-- Editor -->
    <div class="space-y-3">
      <div class="flex gap-2">
        <button
          onclick={() => (preview = false)}
          class="px-3 py-1 text-sm font-medium rounded-md transition-colors {!preview ? 'bg-muted' : 'hover:bg-muted/50'}"
        >
          Write
        </button>
        <button
          onclick={() => (preview = true)}
          class="px-3 py-1 text-sm font-medium rounded-md transition-colors {preview ? 'bg-muted' : 'hover:bg-muted/50'}"
        >
          Preview
        </button>
      </div>

      {#if preview}
        <div class="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-card p-4 min-h-[200px]">
          {#if draft.trim()}
            {@html renderMarkdown(draft)}
          {:else}
            <p class="text-muted-foreground">Nothing to preview.</p>
          {/if}
        </div>
      {:else}
        <textarea
          bind:value={draft}
          placeholder="Write annotation guidelines in Markdown...&#10;&#10;## Overview&#10;Describe what annotators should look for...&#10;&#10;## Categories&#10;Define each annotation category..."
          rows={16}
          class="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring font-mono"
        ></textarea>
      {/if}

      <div class="flex items-center gap-3">
        <button
          onclick={save}
          disabled={saving}
          class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50 disabled:pointer-events-none"
        >
          {saving ? "Saving..." : "Save guidelines"}
        </button>
        <button
          onclick={cancelEditing}
          class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  {:else if guidelines}
    <!-- Read-only rendered view -->
    <div class="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-card p-6">
      {@html renderMarkdown(guidelines)}
    </div>
  {:else}
    <div class="rounded-md border p-8 text-center text-muted-foreground">
      No annotation guidelines have been added yet.
      {#if canEdit}
        <button
          onclick={startEditing}
          class="ml-1 text-primary hover:underline"
        >
          Add guidelines
        </button>
      {/if}
    </div>
  {/if}
</div>
