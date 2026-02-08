/**
 * Generic stage trigger — POSTs to Modal web endpoint for a given stage.
 * Expects the job row to already exist; updates it to running or failed.
 */

import { z } from "zod";
import type { PipelineStage } from "@annotation/shared";
import type { Database } from "@annotation/db";
import { processingJobs, videos } from "@annotation/db";
import { eq } from "drizzle-orm";
import { STAGE_RESULT_KEYS, buildS3KeysIn, getReadyStages } from "./dag.js";
import { env } from "$env/dynamic/private";

const ModalResponseSchema = z.object({
  status: z.enum(["completed", "failed"]),
  error: z.string().nullable().optional(),
});

/** Maps stage to its Modal web endpoint function name (used to build URL). */
const STAGE_FUNCTIONS: Record<PipelineStage, string> = {
  vad: "process-vad-stage",
  transcription: "process-transcription",
  facial_tracking: "process-facial-tracking",
  mouth_energy: "process-mouth-energy",
  diarization: "process-diarization",
  state_annotation: "process-state-annotation",
  intent_classification: "process-intent-classification",
};

export async function triggerStage(
  db: Database,
  videoId: string,
  videoS3Key: string,
  stage: PipelineStage,
  jobId: string,
): Promise<void> {
  const MODAL_BASE_URL = env.MODAL_BASE_URL;
  if (!MODAL_BASE_URL) {
    throw new Error("MODAL_BASE_URL not configured");
  }

  const callbackUrl = env.PUBLIC_APP_URL
    ? `${env.PUBLIC_APP_URL}/api/processing/callback`
    : undefined;

  const PROCESSING_SECRET = env.PROCESSING_CALLBACK_SECRET;
  const resultS3Key = `results/${videoId}/${STAGE_RESULT_KEYS[stage]}`;
  const s3KeysIn = buildS3KeysIn(stage, videoId, videoS3Key);

  // Modal URL format: https://{workspace}--{app}-{function}.modal.run
  // MODAL_BASE_URL should be like: https://johntbrown--annotation-pipeline
  const url = `${MODAL_BASE_URL}-${STAGE_FUNCTIONS[stage]}.modal.run`;

  // Mark as running before the (blocking) POST to Modal
  await db
    .update(processingJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(processingJobs.id, jobId));

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        video_id: videoId,
        s3_keys_in: s3KeysIn,
        result_s3_key: resultS3Key,
        callback_url: callbackUrl,
        callback_secret: PROCESSING_SECRET,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      await db
        .update(processingJobs)
        .set({ status: "failed", errorMessage: `Modal returned ${res.status}: ${text}` })
        .where(eq(processingJobs.id, jobId));
      return;
    }

    // Modal's @fastapi_endpoint is synchronous — 200 means the function ran.
    // Parse the StageResponse to get the actual completion status.
    let body: z.infer<typeof ModalResponseSchema>;
    try {
      body = ModalResponseSchema.parse(await res.json());
    } catch {
      await db
        .update(processingJobs)
        .set({ status: "failed", errorMessage: "Invalid Modal response" })
        .where(eq(processingJobs.id, jobId));
      return;
    }

    if (body.status === "completed") {
      await db
        .update(processingJobs)
        .set({ status: "completed", completedAt: new Date(), resultS3Key: resultS3Key })
        .where(eq(processingJobs.id, jobId));
    } else {
      await db
        .update(processingJobs)
        .set({ status: "failed", errorMessage: body.error ?? "Stage returned non-completed status" })
        .where(eq(processingJobs.id, jobId));
    }
  } catch (err) {
    await db
      .update(processingJobs)
      .set({ status: "failed", errorMessage: String(err) })
      .where(eq(processingJobs.id, jobId));
  }
}

/**
 * Check for stages whose dependencies are all completed and trigger them.
 * Called after a stage completes to cascade the DAG.
 */
export async function triggerReadyStages(
  db: Database,
  videoId: string,
  videoS3Key: string,
): Promise<void> {
  const allJobs = await db
    .select({ id: processingJobs.id, stage: processingJobs.stage, status: processingJobs.status })
    .from(processingJobs)
    .where(eq(processingJobs.videoId, videoId));

  const ready = getReadyStages(allJobs);

  for (const stage of ready) {
    const job = allJobs.find((j) => j.stage === stage);
    if (job) {
      // Fire-and-forget with recursive chaining
      triggerStage(db, videoId, videoS3Key, stage, job.id)
        .then(() => triggerReadyStages(db, videoId, videoS3Key))
        .catch((err) => console.error(`Stage ${stage} cascade error:`, err));
    }
  }
}
