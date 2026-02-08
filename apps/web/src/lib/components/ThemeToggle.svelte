<script lang="ts">
  import { Sun, Moon, Monitor } from "lucide-svelte";
  import { getTheme, cycleTheme } from "$lib/stores/theme.svelte";

  const theme = getTheme();
</script>

<button
  onclick={cycleTheme}
  class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
  title="Theme: {theme.value}"
>
  {#if theme.value === "light"}
    <Sun class="h-4 w-4" />
  {:else if theme.value === "dark"}
    <Moon class="h-4 w-4" />
  {:else}
    <Monitor class="h-4 w-4" />
  {/if}
</button>
