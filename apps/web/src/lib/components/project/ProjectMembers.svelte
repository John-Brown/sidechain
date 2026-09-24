<script lang="ts">
  import { onMount } from "svelte";
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

  const isAdmin = $derived(userRole === "admin");

  interface MemberRow {
    userId: string;
    displayName: string;
    email: string | null;
    role: string;
    addedAt: Date;
  }

  let members = $state<MemberRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Add member form
  let addEmail = $state("");
  let addRole = $state<"annotator" | "supervisor" | "admin">("annotator");
  let adding = $state(false);

  async function loadMembers() {
    loading = true;
    try {
      members = await trpc.projects.listMembers.query({ projectId });
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load members";
    } finally {
      loading = false;
    }
  }

  async function addMember() {
    if (!addEmail.trim()) return;
    adding = true;
    error = null;
    try {
      await trpc.projects.addMember.mutate({
        projectId,
        email: addEmail.trim(),
        role: addRole,
      });
      addEmail = "";
      addRole = "annotator";
      await loadMembers();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to add member";
    } finally {
      adding = false;
    }
  }

  async function changeRole(userId: string, role: string) {
    error = null;
    try {
      await trpc.projects.updateMemberRole.mutate({
        projectId,
        userId,
        role: role as "admin" | "supervisor" | "annotator",
      });
      await loadMembers();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to update role";
    }
  }

  async function removeMember(userId: string) {
    error = null;
    try {
      await trpc.projects.removeMember.mutate({ projectId, userId });
      await loadMembers();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to remove member";
    }
  }

  onMount(() => {
    loadMembers();
  });
</script>

<div class="space-y-6">
  {#if error}
    <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
  {/if}

  <!-- Add member form (admin only) -->
  {#if isAdmin}
    <div class="rounded-md border bg-card p-4">
      <h3 class="text-sm font-medium mb-3">Add member</h3>
      <div class="flex items-end gap-3">
        <div class="flex-1 space-y-1">
          <label for="member-email" class="text-xs text-muted-foreground">Email</label>
          <input
            id="member-email"
            type="email"
            bind:value={addEmail}
            placeholder="user@example.com"
            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          />
        </div>
        <div class="w-36 space-y-1">
          <label for="member-role" class="text-xs text-muted-foreground">Role</label>
          <select
            id="member-role"
            bind:value={addRole}
            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <option value="annotator">Annotator</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          onclick={addMember}
          disabled={adding || !addEmail.trim()}
          class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50 disabled:pointer-events-none"
        >
          {adding ? "Adding..." : "Add"}
        </button>
      </div>
    </div>
  {/if}

  <!-- Members table -->
  {#if loading}
    <div class="rounded-md border p-8 text-center text-muted-foreground">
      Loading members...
    </div>
  {:else if members.length === 0}
    <div class="rounded-md border p-8 text-center text-muted-foreground">
      No members found.
    </div>
  {:else}
    <div class="rounded-md border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b bg-muted/30">
            <th class="px-4 py-3 text-left font-medium">Name</th>
            <th class="px-4 py-3 text-left font-medium">Email</th>
            <th class="px-4 py-3 text-left font-medium">Role</th>
            {#if isAdmin}
              <th class="px-4 py-3 text-right font-medium">Actions</th>
            {/if}
          </tr>
        </thead>
        <tbody class="divide-y">
          {#each members as member (member.userId)}
            <tr>
              <td class="px-4 py-3">{member.displayName}</td>
              <td class="px-4 py-3 text-muted-foreground">{member.email ?? "—"}</td>
              <td class="px-4 py-3">
                {#if isAdmin}
                  <select
                    value={member.role}
                    onchange={(e) => changeRole(member.userId, e.currentTarget.value)}
                    class="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    <option value="annotator">Annotator</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </select>
                {:else}
                  <span class="inline-flex items-center rounded-sm px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                    {member.role}
                  </span>
                {/if}
              </td>
              {#if isAdmin}
                <td class="px-4 py-3 text-right">
                  <button
                    onclick={() => removeMember(member.userId)}
                    class="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    Remove
                  </button>
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
