<script lang="ts">
  import { Sun, Moon, Monitor } from "lucide-svelte";
  import { getTheme, cycleTheme } from "$lib/stores/theme.svelte";

  const theme = getTheme();
</script>

<!--
  Token-based: reads --viewer-* inside .viewer-theme and falls back to the app
  tokens everywhere else, so it matches the surrounding chrome in both places.
-->
<button
  type="button"
  onclick={cycleTheme}
  class="theme-toggle"
  title="Theme: {theme.value}"
  aria-label="Theme: {theme.value}"
>
  {#if theme.value === "light"}
    <Sun class="h-4 w-4" strokeWidth={1.5} />
  {:else if theme.value === "dark"}
    <Moon class="h-4 w-4" strokeWidth={1.5} />
  {:else}
    <Monitor class="h-4 w-4" strokeWidth={1.5} />
  {/if}
</button>

<style>
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 2px;
    color: var(--viewer-text-dim, var(--color-muted-foreground));
    background-color: transparent;
    transition:
      color 150ms ease,
      background-color 150ms ease;
  }

  .theme-toggle:hover {
    color: var(--viewer-text, var(--color-foreground));
    background-color: var(--viewer-accent-bg, var(--color-accent));
  }

  .theme-toggle:focus-visible {
    outline: 2px solid var(--viewer-accent, var(--color-ring));
    outline-offset: 1px;
  }

  :global(.viewer-theme) .theme-toggle {
    width: 28px;
    height: 28px;
  }
</style>
