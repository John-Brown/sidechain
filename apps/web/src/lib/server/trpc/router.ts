import { router } from "./trpc.js";
import { videosRouter } from "./routers/videos.js";
import { processingRouter } from "./routers/processing.js";
import { projectsRouter } from "./routers/projects.js";
import { annotationsRouter } from "./routers/annotations.js";
import { tasksRouter } from "./routers/tasks.js";

export const appRouter = router({
  videos: videosRouter,
  processing: processingRouter,
  projects: projectsRouter,
  annotations: annotationsRouter,
  tasks: tasksRouter,
});

export type AppRouter = typeof appRouter;
