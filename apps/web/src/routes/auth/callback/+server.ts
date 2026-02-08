import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/videos";

  if (code) {
    const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect(303, next);
    }
  }

  redirect(303, "/auth/login?error=auth_callback_failed");
};
