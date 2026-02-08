<script lang="ts">
  import { createSupabaseBrowserClient } from "$lib/supabase";

  const supabase = createSupabaseBrowserClient();

  let email = $state("");
  let password = $state("");
  let confirmPassword = $state("");
  let error = $state<string | null>(null);
  let success = $state(false);
  let loading = $state(false);

  async function handleSignup(e: SubmitEvent) {
    e.preventDefault();
    error = null;

    if (password !== confirmPassword) {
      error = "Passwords do not match.";
      return;
    }

    loading = true;

    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      error = authError.message;
      loading = false;
      return;
    }

    success = true;
    loading = false;
  }
</script>

<div class="w-full max-w-sm space-y-6">
  <div class="space-y-2 text-center">
    <h1 class="text-2xl font-semibold tracking-tight">Create an account</h1>
    <p class="text-sm text-muted-foreground">
      Enter your email to get started
    </p>
  </div>

  {#if success}
    <div class="rounded-md bg-primary/10 p-4 text-sm text-primary">
      Check your email for a confirmation link to complete your registration.
    </div>
  {:else}
    <form onsubmit={handleSignup} class="space-y-4">
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

      <div class="space-y-2">
        <label for="confirm-password" class="text-sm font-medium leading-none">Confirm password</label>
        <input
          id="confirm-password"
          type="password"
          bind:value={confirmPassword}
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
        {loading ? "Creating account..." : "Create account"}
      </button>
    </form>
  {/if}

  <p class="text-center text-sm text-muted-foreground">
    Already have an account?
    <a href="/auth/login" class="font-medium text-primary underline-offset-4 hover:underline">
      Sign in
    </a>
  </p>
</div>
