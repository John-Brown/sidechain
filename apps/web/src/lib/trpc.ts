import { createTRPCClient, httpBatchLink } from "@trpc/client";

import type { AppRouter } from "$lib/server/trpc/router";

export function createTRPCClientInstance(getToken: () => Promise<string | null>) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        async headers() {
          const token = await getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
