<script lang="ts">
  import type { PageData } from "./$types";
  import AnnotationViewer from "$lib/components/viewer/AnnotationViewer.svelte";

  let { data }: { data: PageData } = $props();
</script>

<AnnotationViewer videoId={data.videoId} />
