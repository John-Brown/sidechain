<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    height?: number;
    children: Snippet;
  }

  let { label, height = 48, children }: Props = $props();
</script>

<div class="flex border-b border-viewer-border" style="height: {height}px">
  <div
    class="shrink-0 flex items-center px-3 text-viewer-base text-viewer-text-dim border-r border-viewer-border bg-viewer-surface"
    style="width: 120px"
  >
    {label}
  </div>
  <div class="flex-1 relative overflow-hidden">
    {@render children()}
  </div>
</div>
