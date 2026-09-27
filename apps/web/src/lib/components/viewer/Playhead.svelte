<script lang="ts">
  import { getTimelineState } from './context.js';

  interface Props {
    /** Draw the 7px cap. Only the ruler copy has it; the track overlay is the line alone. */
    cap?: boolean;
  }

  let { cap = true }: Props = $props();

  const timeline = getTimelineState();

  // Absolute position within timeline for translateX
  const absX = $derived(timeline.timeToPx(timeline.currentTime));
  // Viewport-relative position for visibility check
  const viewX = $derived(absX - timeline.scrollLeft);
</script>

<!-- 1px brick line with a 7px downward cap (timeline-screen.html). Above locked overlays. -->
{#if viewX >= -6 && viewX <= timeline.containerWidth + 6}
  <div
    class="playhead absolute top-0 bottom-0 left-0 pointer-events-none z-30"
    style="transform: translateX({absX}px);"
    aria-hidden="true"
  >
    {#if cap}<div class="playhead-cap"></div>{/if}
  </div>
{/if}

<style>
  .playhead {
    width: 1px;
    background-color: var(--viewer-playhead);
    will-change: transform;
  }

  .playhead-cap {
    position: absolute;
    left: -5px;
    top: 0;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 7px solid var(--viewer-playhead);
  }
</style>
