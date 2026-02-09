<script lang="ts">
  interface Props {
    editCount: number;
    elapsedSecs: number;
    coverageErrors: string[];
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { editCount, elapsedSecs, coverageErrors, onConfirm, onCancel }: Props = $props();

  const hasCoverageErrors = $derived(coverageErrors.length > 0);

  function formatElapsed(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<!-- Backdrop -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
  role="dialog"
  aria-modal="true"
>
  <div class="bg-viewer-surface border border-viewer-border rounded-lg shadow-xl max-w-md w-full mx-4 p-5">
    <h2 class="text-base font-medium text-viewer-text mb-3">Submit for Review</h2>

    <!-- Stats -->
    <div class="space-y-1.5 mb-4">
      <div class="flex justify-between text-sm text-viewer-text-dim">
        <span>Edits made</span>
        <span class="text-viewer-text tabular-nums">{editCount}</span>
      </div>
      <div class="flex justify-between text-sm text-viewer-text-dim">
        <span>Time spent</span>
        <span class="text-viewer-text tabular-nums">{formatElapsed(elapsedSecs)}</span>
      </div>
    </div>

    <!-- Coverage validation -->
    {#if hasCoverageErrors}
      <div class="p-3 rounded bg-red-900/20 border border-red-800/30 mb-4">
        <div class="text-sm font-medium text-red-400 mb-1.5">Coverage issues</div>
        <ul class="space-y-1">
          {#each coverageErrors as error}
            <li class="text-viewer-sm text-red-300">{error}</li>
          {/each}
        </ul>
        <div class="text-viewer-sm text-red-400/80 mt-2">
          Fix these issues before submitting.
        </div>
      </div>
    {/if}

    <!-- Actions -->
    <div class="flex gap-3 justify-end">
      <button
        onclick={onCancel}
        class="px-4 py-2 text-sm rounded text-viewer-text-dim hover:text-viewer-text transition-colors"
      >
        Cancel
      </button>
      <button
        onclick={onConfirm}
        disabled={hasCoverageErrors}
        class="px-4 py-2 text-sm rounded font-medium transition-colors {hasCoverageErrors
          ? 'bg-gray-600/30 text-gray-500 cursor-not-allowed'
          : 'bg-indigo-600 text-white hover:bg-indigo-500'}"
      >
        Submit
      </button>
    </div>
  </div>
</div>
