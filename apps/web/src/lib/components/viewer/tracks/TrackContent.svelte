<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    height?: number;
    children: Snippet;
  }

  let { height = 48, children }: Props = $props();
</script>

<div class="border-b border-viewer-border relative overflow-hidden" style="height: {height}px">
  {@render children()}
</div>
