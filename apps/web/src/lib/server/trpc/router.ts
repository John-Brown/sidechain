import { router } from "./trpc.js";
import { videosRouter } from "./routers/videos.js";
import { processingRouter } from "./routers/processing.js";
import { projectsRouter } from "./routers/projects.js";

export const appRouter = router({
  videos: videosRouter,
  processing: processingRouter,
  projects: projectsRouter,
});

export type AppRouter = typeof appRouter;
