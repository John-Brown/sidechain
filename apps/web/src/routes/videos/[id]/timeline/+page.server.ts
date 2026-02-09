import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const { session } = await locals.safeGetSession();
  if (!session) {
    redirect(303, "/auth/login");
  }

  const taskId = url.searchParams.get("taskId") ?? undefined;

  return { videoId: params.id, taskId };
};
