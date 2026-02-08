<script lang="ts">
  import { getTimelineState } from './context.js';

  const timeline = getTimelineState();

  const xPos = $derived(timeline.timeToPx(timeline.currentTime) - timeline.scrollLeft);
</script>

{#if xPos >= -2 && xPos <= timeline.containerWidth + 2}
  <div
    class="absolute top-0 bottom-0 pointer-events-none z-20"
    style="transform: translateX({xPos}px); will-change: transform;"
  >
    <div class="w-0.5 h-full bg-red-500"></div>
  </div>
{/if}
