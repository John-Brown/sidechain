<script lang="ts">
  interface Props {
    onComplete: () => void;
  }

  let { onComplete }: Props = $props();

  let file = $state<File | null>(null);
  let dragOver = $state(false);
  let uploading = $state(false);
  let progress = $state(0);
  let error = $state<string | null>(null);

  const ACCEPTED_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];
  const MAX_SIZE_GB = 5;
  const MAX_SIZE_BYTES = MAX_SIZE_GB * 1024 * 1024 * 1024;

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped) selectFile(dropped);
  }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const selected = input.files?.[0];
    if (selected) selectFile(selected);
  }

  function selectFile(f: File) {
    error = null;
    if (!ACCEPTED_TYPES.includes(f.type)) {
      error = `Unsupported file type: ${f.type}. Use MP4, WebM, MOV, or AVI.`;
      return;
    }
    if (f.size > MAX_SIZE_BYTES) {
      error = `File too large. Maximum size is ${MAX_SIZE_GB}GB.`;
      return;
    }
    file = f;
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async function handleUpload() {
    if (!file) return;
    uploading = true;
    progress = 0;
    error = null;

    try {
      // TODO: Implement S3 multipart upload via tRPC:
      // 1. Call tRPC getUploadUrls to get presigned URLs
      // 2. Upload each part with XMLHttpRequest for progress tracking
      // 3. Call tRPC completeUpload
      // 4. Call tRPC createVideo to create the database record

      // Simulating upload progress for now
      for (let i = 0; i <= 100; i += 10) {
        await new Promise((r) => setTimeout(r, 100));
        progress = i / 100;
      }

      onComplete();
    } catch (e) {
      error = e instanceof Error ? e.message : "Upload failed";
      uploading = false;
    }
  }
</script>

<div class="rounded-md border bg-card p-6 space-y-4">
  {#if !file}
    <!-- Drop zone -->
    <div
      role="button"
      tabindex="0"
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
      onclick={() => document.getElementById("file-input")?.click()}
      onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") document.getElementById("file-input")?.click(); }}
      class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors cursor-pointer
        {dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}"
    >
      <svg class="h-10 w-10 text-muted-foreground mb-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
      <p class="text-sm font-medium">Drop a video file here or click to browse</p>
      <p class="text-xs text-muted-foreground mt-1">MP4, WebM, MOV, AVI up to {MAX_SIZE_GB}GB</p>
      <input
        id="file-input"
        type="file"
        accept="video/*"
        class="hidden"
        onchange={handleFileInput}
      />
    </div>
  {:else}
    <!-- Selected file -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <svg class="h-8 w-8 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
        <div>
          <p class="text-sm font-medium">{file.name}</p>
          <p class="text-xs text-muted-foreground">{formatSize(file.size)}</p>
        </div>
      </div>
      {#if !uploading}
        <button
          onclick={() => (file = null)}
          class="text-sm text-muted-foreground hover:text-foreground"
        >
          Remove
        </button>
      {/if}
    </div>

    {#if uploading}
      <!-- Progress bar -->
      <div class="space-y-2">
        <div class="flex justify-between text-sm">
          <span class="text-muted-foreground">Uploading...</span>
          <span class="font-medium">{Math.round(progress * 100)}%</span>
        </div>
        <div class="h-2 rounded-full bg-muted overflow-hidden">
          <div
            class="h-full bg-primary transition-all duration-300"
            style="width: {progress * 100}%"
          ></div>
        </div>
      </div>
    {:else}
      <button
        onclick={handleUpload}
        class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Upload
      </button>
    {/if}
  {/if}

  {#if error}
    <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      {error}
    </div>
  {/if}
</div>
