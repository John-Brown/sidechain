<script lang="ts">
  import { getTimelineState } from './context.js';

  const timeline = getTimelineState();

  // Absolute position within timeline for translateX
  const absX = $derived(timeline.timeToPx(timeline.currentTime));
  // Viewport-relative position for visibility check
  const viewX = $derived(absX - timeline.scrollLeft);
</script>

{#if viewX >= -2 && viewX <= timeline.containerWidth + 2}
  <div
    class="absolute top-0 bottom-0 pointer-events-none z-20"
    style="transform: translateX({absX}px); will-change: transform;"
  >
    <div class="w-0.5 h-full bg-red-500"></div>
  </div>
{/if}
