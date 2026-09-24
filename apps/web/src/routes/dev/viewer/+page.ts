/**
 * Dev-only fixture route for visually verifying the design pass without a
 * real video, DB or auth: `/dev/viewer?mode=view|edit|task&theme=day|night&t=53.6`.
 *
 * `ssr = false` so the (fairly large — ~250s of synthetic per-frame data)
 * fixture is built once in the browser and handed to the component directly,
 * instead of being serialized through the SSR hydration payload.
 */
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { CreateViewerFixtureOptions } from '$lib/components/viewer/fixtures/generate.js';
import type { PageLoad } from './$types';

export const ssr = false;

type Mode = NonNullable<CreateViewerFixtureOptions['mode']>;
type ThemeParam = 'day' | 'night';

function parseMode(value: string | null): Mode {
  return value === 'edit' || value === 'task' ? value : 'view';
}

function parseTheme(value: string | null): ThemeParam {
  return value === 'night' ? 'night' : 'day';
}

function parseInitialTime(value: string | null): number {
  const n = value ? Number(value) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export const load: PageLoad = async ({ url }) => {
  // Dev-only: never reachable in a production build (`dev` is inlined false there).
  if (!dev) error(404);

  // Imported after the guard: the generator is split into its own chunk that a production build never fetches.
  const { createViewerFixture } = await import('$lib/components/viewer/fixtures/generate.js');

  const mode = parseMode(url.searchParams.get('mode'));
  const theme = parseTheme(url.searchParams.get('theme'));
  const initialTime = parseInitialTime(url.searchParams.get('t'));

  return {
    mode,
    theme,
    initialTime,
    fixture: createViewerFixture({ mode }),
  };
};
