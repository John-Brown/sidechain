<script lang="ts">
  import type { PageData } from "./$types";
  import AnnotationViewer from "$lib/components/viewer/AnnotationViewer.svelte";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Timeline — Sidechain</title>
</svelte:head>

<AnnotationViewer videoId={data.videoId} taskId={data.taskId} />
