// --- Pipeline stages ---

export const PIPELINE_STAGES = [
  "vad",
  "transcription",
  "facial_tracking",
  "mouth_energy",
  "diarization",
  "state_annotation",
  "intent_classification",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// --- Job status ---

export const JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

// --- Video status ---

export const VIDEO_STATUSES = [
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "error",
] as const;

export type VideoStatus = (typeof VIDEO_STATUSES)[number];

// --- Annotation set types ---

export const ANNOTATION_SET_TYPES = [
  "state",
  "intent",
  "backchannel",
  "session_bounds",
  "transcription",
] as const;

export type AnnotationSetType = (typeof ANNOTATION_SET_TYPES)[number];

// --- Annotation source ---

export const ANNOTATION_SOURCES = ["ai", "human", "supervisor_override"] as const;

export type AnnotationSource = (typeof ANNOTATION_SOURCES)[number];

// --- Edit types ---

export const EDIT_TYPES = [
  "create",
  "resize",
  "delete",
  "split",
  "merge",
  "classify",
  "bulk",
] as const;

export type EditType = (typeof EDIT_TYPES)[number];

// --- Task types ---

export const TASK_TYPES = [
  "tag_session_bounds",
  "verify_states",
  "verify_intents",
  "tag_backchannels",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

// --- Task status ---

export const TASK_STATUSES = [
  "pending",
  "assigned",
  "in_progress",
  "submitted",
  "under_review",
  "approved",
  "rejected",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

// --- User roles ---

export const USER_ROLES = ["admin", "supervisor", "annotator"] as const;

export type UserRole = (typeof USER_ROLES)[number];

// --- Project member roles ---

export const PROJECT_MEMBER_ROLES = [
  "admin",
  "supervisor",
  "annotator",
] as const;

export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

// --- Processing job type for API responses ---

export interface ProcessingJobInfo {
  id: string;
  videoId: string;
  stage: PipelineStage;
  status: JobStatus;
  progress: number;
  resultS3Key: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}
