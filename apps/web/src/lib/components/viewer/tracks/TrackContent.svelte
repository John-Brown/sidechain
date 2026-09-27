<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TrackId } from '../state/tracks.svelte.js';

  /**
   * Track content cell: fixed height, bottom rule, clips its track. The height
   * only changes on commit (TrackLabel resize pointerup), never mid-drag.
   */
  interface Props {
    height?: number;
    /** Track id, exposed as data-track-id for row lookups */
    id?: TrackId;
    children: Snippet;
  }

  let { height = 48, id, children }: Props = $props();
</script>

<div
  class="border-b border-viewer-border relative overflow-hidden"
  style="height: {height}px"
  data-track-content={id}
>
  {@render children()}
</div>
