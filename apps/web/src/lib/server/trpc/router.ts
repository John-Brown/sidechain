import { router } from "./trpc.js";
import { videosRouter } from "./routers/videos.js";
import { processingRouter } from "./routers/processing.js";

export const appRouter = router({
  videos: videosRouter,
  processing: processingRouter,
});

export type AppRouter = typeof appRouter;
