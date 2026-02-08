<script lang="ts">
  import "../app.css";
  import { goto, invalidateAll } from "$app/navigation";
  import { onMount } from "svelte";
  import { createSupabaseBrowserClient } from "$lib/supabase";
  import { page } from "$app/state";

  let { children, data } = $props();

  const supabase = createSupabaseBrowserClient();

  onMount(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      if (session?.expires_at !== data.session?.expires_at) {
        invalidateAll();
      }
    });

    return () => subscription.unsubscribe();
  });

  const isAuthRoute = $derived(page.url.pathname.startsWith("/auth"));

  async function signOut() {
    await supabase.auth.signOut();
    goto("/auth/login");
  }
</script>

{#if isAuthRoute || !data.session}
  <main class="min-h-screen flex items-center justify-center bg-muted/40">
    {@render children()}
  </main>
{:else}
  <div class="flex min-h-screen">
    <aside class="w-64 border-r bg-sidebar text-sidebar-foreground flex flex-col">
      <div class="p-6 border-b">
        <h1 class="text-lg font-semibold tracking-tight">Annotation</h1>
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
      </nav>
      <div class="p-4 border-t">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted-foreground truncate">
            {data.user?.email ?? ""}
          </span>
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
