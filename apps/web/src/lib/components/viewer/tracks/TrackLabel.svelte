<script lang="ts">
  interface Props {
    label: string;
    height?: number;
  }

  let { label, height = 48 }: Props = $props();
</script>

<div
  class="flex items-center px-3 text-viewer-base text-viewer-text-dim border-r border-b border-viewer-border bg-viewer-surface"
  style="height: {height}px"
>
  {label}
</div>
