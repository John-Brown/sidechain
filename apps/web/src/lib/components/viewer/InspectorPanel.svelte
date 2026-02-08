<script lang="ts">
  import { getSessionState } from './context.js';
  import { formatTimePrecise } from './utils/format-time.js';

  const session = getSessionState();

  const annotation = $derived(session.selectedAnnotation);
</script>

<div class="h-full overflow-y-auto p-3 bg-viewer-surface text-xs">
  {#if annotation}
    <h3 class="text-viewer-text font-medium mb-2">Annotation Details</h3>
    <div class="space-y-1.5">
      {#each Object.entries(annotation) as [key, value]}
        <div>
          <span class="text-viewer-text-dim">{key}:</span>
          {#if key === 'time_range' && typeof value === 'object' && value !== null && 'start' in value && 'end' in value}
            <span class="text-viewer-text font-mono">
              {formatTimePrecise((value as {start: number}).start)} - {formatTimePrecise((value as {end: number}).end)}
            </span>
          {:else if typeof value === 'object' && value !== null}
            <pre class="text-viewer-text font-mono mt-0.5 whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
          {:else}
            <span class="text-viewer-text font-mono">{String(value)}</span>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-viewer-text-dim italic">Click an annotation to inspect</p>
  {/if}
</div>
