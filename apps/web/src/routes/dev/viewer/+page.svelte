<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import type { PageData } from './$types';
  import AnnotationViewer from '$lib/components/viewer/AnnotationViewer.svelte';

  let { data }: { data: PageData } = $props();

  // ?theme=day|night applies the `.dark` class for this page only. It never
  // goes through setTheme(), so the saved theme is left alone; the previous
  // class comes back when the route unmounts. The viewer's palette follows the
  // class through its MutationObserver.
  const hadDark = browser && document.documentElement.classList.contains('dark');

  $effect.pre(() => {
    document.documentElement.classList.toggle('dark', data.theme === 'night');
  });

  onMount(() => () => {
    document.documentElement.classList.toggle('dark', hadDark);
  });
</script>

<svelte:head>
  <title>Dev viewer fixture — Sidechain</title>
</svelte:head>

<AnnotationViewer videoId="fixture" fixture={data.fixture} initialTime={data.initialTime} />
