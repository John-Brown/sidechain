/**
 * Pipeline DAG — defines stage dependencies and resolves ready stages.
 */

import type { PipelineStage } from "@annotation/shared";
import { PIPELINE_STAGES } from "@annotation/shared";

/**
 * Each stage maps to its direct dependency stages.
 * A stage is ready when all its dependencies have completed.
 */
export const STAGE_DEPS: Record<PipelineStage, PipelineStage[]> = {
  vad: [],
  transcription: [],
  facial_tracking: [],
  mouth_energy: ["facial_tracking"],
  diarization: ["vad", "mouth_energy"],
  state_annotation: ["diarization"],
  intent_classification: ["state_annotation", "transcription", "vad"],
};

/** Root stages with no dependencies — can be triggered immediately. */
export const ROOT_STAGES: PipelineStage[] = PIPELINE_STAGES.filter(
  (s) => STAGE_DEPS[s].length === 0,
);

/** S3 result filename for each stage's output. */
export const STAGE_RESULT_KEYS: Record<PipelineStage, string> = {
  vad: "voice_activity.json",
  transcription: "speech_transcription.json",
  facial_tracking: "facial_tracking.json",
  mouth_energy: "mouth_energy.json",
  diarization: "diarization.json",
  state_annotation: "annotations.json",
  intent_classification: "intent_classification_annotations.json",
};

/**
 * Input S3 key mapping for each stage.
 * Maps from the input name (matching StageRequest.s3_keys_in keys)
 * to either the upstream stage that produces the data or "video" for the source video.
 */
export const STAGE_INPUT_KEYS: Record<PipelineStage, Record<string, PipelineStage | "video">> = {
  vad: { video: "video" },
  transcription: { video: "video" },
  facial_tracking: { video: "video" },
  mouth_energy: { facial_tracking: "facial_tracking" },
  diarization: { video: "video", vad: "vad", mouth_energy: "mouth_energy" },
  state_annotation: { diarization: "diarization" },
  intent_classification: {
    states: "state_annotation",
    transcription: "transcription",
    vad: "vad",
  },
};

export function getResultS3Key(videoId: string, stage: PipelineStage): string {
  return `results/${videoId}/${STAGE_RESULT_KEYS[stage]}`;
}

/**
 * Build the s3_keys_in dict for a given stage.
 * videoS3Key is the source video key.
 * videoId is used to construct result paths.
 */
export function buildS3KeysIn(
  stage: PipelineStage,
  videoId: string,
  videoS3Key: string,
): Record<string, string> {
  const inputSpec = STAGE_INPUT_KEYS[stage];
  const result: Record<string, string> = {};

  for (const [inputKey, source] of Object.entries(inputSpec)) {
    if (source === "video") {
      result[inputKey] = videoS3Key;
    } else {
      result[inputKey] = `results/${videoId}/${STAGE_RESULT_KEYS[source]}`;
    }
  }

  return result;
}

interface JobInfo {
  stage: PipelineStage;
  status: string;
}

/**
 * Stages not yet production-ready — skipped by the orchestrator.
 * TODO: Remove entries as each stage is validated and ready for production.
 * - diarization: pyannote use_auth_token API change needs fix
 * - state_annotation: depends on diarization
 * - intent_classification: depends on state_annotation + needs Anthropic API key
 */
export const IN_DEVELOPMENT_STAGES: Set<PipelineStage> = new Set([
  "diarization",
  "state_annotation",
  "intent_classification",
]);

/**
 * Given current job statuses, return stages that are ready to run:
 * - All dependencies are 'completed'
 * - Own status is 'pending'
 * - Not in the IN_DEVELOPMENT set
 */
export function getReadyStages(jobs: JobInfo[]): PipelineStage[] {
  const statusMap = new Map(jobs.map((j) => [j.stage, j.status]));

  return jobs
    .filter((j) => j.status === "pending")
    .filter((j) => !IN_DEVELOPMENT_STAGES.has(j.stage))
    .filter((j) => {
      const deps = STAGE_DEPS[j.stage];
      return deps.every((dep) => statusMap.get(dep) === "completed");
    })
    .map((j) => j.stage);
}
