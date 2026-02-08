import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { createDb, processingJobs, videos } from "@annotation/db";
import { eq } from "drizzle-orm";
import { getReadyStages } from "$lib/server/pipeline/dag.js";
import { triggerStage } from "$lib/server/pipeline/trigger.js";

const PROCESSING_SECRET = process.env.PROCESSING_CALLBACK_SECRET;

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return createDb(url);
}

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get("x-callback-secret");
  if (!PROCESSING_SECRET || authHeader !== PROCESSING_SECRET) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    job_id: string;
    status: "completed" | "failed";
    result_s3_key?: string;
    error_message?: string;
  };

  if (!body.job_id || !body.status) {
    return json({ error: "Missing job_id or status" }, { status: 400 });
  }

  const db = getDb();

  const [job] = await db
    .select()
    .from(processingJobs)
    .where(eq(processingJobs.id, body.job_id))
    .limit(1);

  if (!job) {
    return json({ error: "Job not found" }, { status: 404 });
  }

  if (body.status === "completed") {
    await db
      .update(processingJobs)
      .set({
        status: "completed",
        resultS3Key: body.result_s3_key ?? job.resultS3Key,
        completedAt: new Date(),
        progress: 1,
      })
      .where(eq(processingJobs.id, body.job_id));

    // Fetch all jobs for this video to check DAG readiness
    const allJobs = await db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.videoId, job.videoId));

    // Update the completed job's status in the local list for accurate dependency check
    const updatedJobs = allJobs.map((j) =>
      j.id === body.job_id ? { ...j, status: "completed" as const } : j,
    );

    // Check which stages are now ready to run
    const readyStages = getReadyStages(
      updatedJobs.map((j) => ({ stage: j.stage, status: j.status })),
    );

    if (readyStages.length > 0) {
      // Get video for s3Key
      const [video] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, job.videoId))
        .limit(1);

      if (video) {
        for (const stage of readyStages) {
          const stageJob = updatedJobs.find((j) => j.stage === stage);
          if (stageJob) {
            // Fire and forget — don't block the callback response
            triggerStage(db, video.id, video.s3Key, stage, stageJob.id).catch(
              (err) => console.error(`Failed to trigger ${stage}:`, err),
            );
          }
        }
      }
    }

    // Check if ALL jobs are now completed
    const allCompleted = updatedJobs.every((j) => j.status === "completed");
    if (allCompleted) {
      await db
        .update(videos)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(videos.id, job.videoId));
    }
  } else {
    // Failed
    await db
      .update(processingJobs)
      .set({
        status: "failed",
        errorMessage: body.error_message ?? "Unknown error",
        completedAt: new Date(),
      })
      .where(eq(processingJobs.id, body.job_id));

    // Don't set video to error immediately — other stages may still be running
    // Only set error if no stages are running and at least one failed
    const allJobs = await db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.videoId, job.videoId));

    const hasRunning = allJobs.some(
      (j) => j.id !== body.job_id && (j.status === "running" || j.status === "pending"),
    );

    if (!hasRunning) {
      await db
        .update(videos)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(videos.id, job.videoId));
    }
  }

  return json({ ok: true });
};
