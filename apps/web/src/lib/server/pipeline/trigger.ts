/**
 * Generic stage trigger — POSTs to Modal web endpoint for a given stage.
 * Expects the job row to already exist; updates it to running or failed.
 */

import type { PipelineStage } from "@annotation/shared";
import type { Database } from "@annotation/db";
import { processingJobs } from "@annotation/db";
import { eq } from "drizzle-orm";
import { STAGE_RESULT_KEYS, buildS3KeysIn } from "./dag.js";

const MODAL_BASE_URL = process.env.MODAL_BASE_URL;
const PROCESSING_SECRET = process.env.PROCESSING_CALLBACK_SECRET;

/** Maps stage to its Modal web endpoint function name. */
const STAGE_ENDPOINTS: Record<PipelineStage, string> = {
  vad: "process_vad_stage",
  transcription: "process_transcription",
  facial_tracking: "process_facial_tracking",
  mouth_energy: "process_mouth_energy",
  diarization: "process_diarization",
  state_annotation: "process_state_annotation",
  intent_classification: "process_intent_classification",
};

export async function triggerStage(
  db: Database,
  videoId: string,
  videoS3Key: string,
  stage: PipelineStage,
  jobId: string,
): Promise<void> {
  if (!MODAL_BASE_URL) {
    throw new Error("MODAL_BASE_URL not configured");
  }

  const callbackUrl = process.env.PUBLIC_APP_URL
    ? `${process.env.PUBLIC_APP_URL}/api/processing/callback`
    : undefined;

  const resultS3Key = `results/${videoId}/${STAGE_RESULT_KEYS[stage]}`;
  const s3KeysIn = buildS3KeysIn(stage, videoId, videoS3Key);

  const url = `${MODAL_BASE_URL}/${STAGE_ENDPOINTS[stage]}`;

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

    await db
      .update(processingJobs)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(processingJobs.id, jobId));
  } catch (err) {
    await db
      .update(processingJobs)
      .set({ status: "failed", errorMessage: String(err) })
      .where(eq(processingJobs.id, jobId));
  }
}
