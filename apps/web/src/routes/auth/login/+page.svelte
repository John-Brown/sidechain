<script lang="ts">
  import { createSupabaseBrowserClient } from "$lib/supabase";
  import { goto } from "$app/navigation";

  const supabase = createSupabaseBrowserClient();

  let email = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    loading = true;

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      error = authError.message;
      loading = false;
      return;
    }

    goto("/videos");
  }
</script>

<svelte:head>
  <title>Sign In — Sidechain</title>
</svelte:head>

<div class="w-full max-w-sm space-y-6">
  <div class="space-y-2 text-center">
    <h1 class="text-2xl font-semibold tracking-tight">Sign in</h1>
    <p class="text-sm text-muted-foreground">
      Enter your credentials to continue
    </p>
  </div>

  <form onsubmit={handleLogin} class="space-y-4">
    {#if error}
      <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    {/if}

    <div class="space-y-2">
      <label for="email" class="text-sm font-medium leading-none">Email</label>
      <input
        id="email"
        type="email"
        bind:value={email}
        required
        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        placeholder="you@example.com"
      />
    </div>

    <div class="space-y-2">
      <label for="password" class="text-sm font-medium leading-none">Password</label>
      <input
        id="password"
        type="password"
        bind:value={password}
        required
        minlength={6}
        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        placeholder="••••••••"
      />
    </div>

    <button
      type="submit"
      disabled={loading}
      class="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
    >
      {loading ? "Signing in..." : "Sign in"}
    </button>
  </form>

  <p class="text-center text-sm text-muted-foreground">
    Don't have an account?
    <a href="/auth/signup" class="font-medium text-primary underline-offset-4 hover:underline">
      Sign up
    </a>
  </p>
</div>
