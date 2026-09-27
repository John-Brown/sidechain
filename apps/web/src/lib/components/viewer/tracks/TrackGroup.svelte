<script lang="ts">
  import { GROUP_HEADER_HEIGHT, type TrackGroup } from '../state/tracks.svelte.js';

  /**
   * Group header row (Audio / Face / Annotations): chevron, mono uppercase
   * name, and the track count, or "N hidden" when collapsed. The whole label
   * cell is the toggle; collapse state lives in TrackLayoutState.
   *
   * Renders a full row: a label cell `labelWidth` px wide plus a filler. In a
   * split label/content layout, pass `labelWidth={null}` to fill the label
   * column and render a plain 22px `bg-viewer-surface-2 border-b` spacer in
   * the content column.
   */
  interface Props {
    id: TrackGroup;
    label: string;
    collapsed: boolean;
    /** Tracks in the group (available ones) */
    count: number;
    onToggle?: (id: TrackGroup) => void;
    /** Label cell width in px; null fills the row */
    labelWidth?: number | null;
  }

  let { id, label, collapsed, count, onToggle, labelWidth = 184 }: Props = $props();
</script>

<div
  class="flex bg-viewer-surface-2 border-b border-viewer-border"
  style="height: {GROUP_HEADER_HEIGHT}px"
  data-track-group-header={id}
>
  <button
    type="button"
    class="group-toggle flex items-center gap-1.5 px-2 border-r border-viewer-border text-viewer-text-dim hover:text-viewer-text"
    class:flex-1={labelWidth == null}
    style={labelWidth != null ? `width: ${labelWidth}px; flex: none;` : undefined}
    aria-expanded={!collapsed}
    aria-label="{collapsed ? 'Expand' : 'Collapse'} {label} tracks"
    onclick={() => onToggle?.(id)}
  >
    {#if collapsed}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
    {:else}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
    {/if}
    <span class="font-mono text-viewer-xs uppercase tracking-label">{label}</span>
    <span class="font-mono text-viewer-xs text-viewer-text-subtle">{collapsed ? `${count} hidden` : count}</span>
  </button>
  {#if labelWidth != null}
    <div class="flex-1"></div>
  {/if}
</div>

<style>
  .group-toggle {
    transition: color 150ms;
  }
</style>
