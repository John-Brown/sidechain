import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { createDb, processingJobs, videos } from "@annotation/db";
import { eq } from "drizzle-orm";

const PROCESSING_SECRET = process.env.PROCESSING_CALLBACK_SECRET;

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return createDb(url);
}

export const POST: RequestHandler = async ({ request }) => {
  // Verify shared secret
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

    // Check if all jobs for this video are complete to update video status
    const allJobs = await db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.videoId, job.videoId));

    const allCompleted = allJobs.every(
      (j) => j.id === body.job_id || j.status === "completed",
    );

    if (allCompleted) {
      await db
        .update(videos)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(videos.id, job.videoId));
    }
  } else {
    await db
      .update(processingJobs)
      .set({
        status: "failed",
        errorMessage: body.error_message ?? "Unknown error",
        completedAt: new Date(),
      })
      .where(eq(processingJobs.id, body.job_id));

    await db
      .update(videos)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(videos.id, job.videoId));
  }

  return json({ ok: true });
};
