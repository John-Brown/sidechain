import { createServerClient } from "@supabase/ssr";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "$env/static/public";
import type { Cookies } from "@sveltejs/kit";

export function createSupabaseServerClient(cookies: Cookies) {
  return createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () =>
        cookies.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, { ...options, path: "/" } as Parameters<Cookies["set"]>[2]);
        });
      },
    },
  });
}
