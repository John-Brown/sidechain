import type { RequestHandler } from "@sveltejs/kit";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "$lib/server/trpc/router.js";
import { createContext } from "$lib/server/trpc/context.js";

const handler: RequestHandler = async (event) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: event.request,
    router: appRouter,
    createContext: () => createContext(event),
  });
};

export const GET = handler;
export const POST = handler;
