import { createSupabaseServerClient } from "$lib/server/supabase";
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createSupabaseServerClient(event.cookies);

  event.locals.safeGetSession = async () => {
    const {
      data: { user },
      error,
    } = await event.locals.supabase.auth.getUser();

    if (error || !user) {
      return { session: null, user: null };
    }

    // Only fetch session after user is verified server-side
    const {
      data: { session },
    } = await event.locals.supabase.auth.getSession();

    return { session, user };
  };

  return resolve(event, {
    filterSerializedResponseHeaders(name) {
      return name === "content-range" || name === "x-supabase-api-version";
    },
  });
};
