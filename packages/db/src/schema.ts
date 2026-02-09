import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  real,
  jsonb,
  boolean,
  integer,
  date,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// --- Enums ---

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "supervisor",
  "annotator",
]);

export const projectMemberRoleEnum = pgEnum("project_member_role", [
  "admin",
  "supervisor",
  "annotator",
]);

export const videoStatusEnum = pgEnum("video_status", [
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "error",
]);

export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "vad",
  "transcription",
  "facial_tracking",
  "mouth_energy",
  "diarization",
  "state_annotation",
  "intent_classification",
  "waveform",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const annotationSetTypeEnum = pgEnum("annotation_set_type", [
  "state",
  "intent",
  "backchannel",
  "session_bounds",
  "transcription",
  "user_labels",
]);

export const annotationSourceEnum = pgEnum("annotation_source", [
  "ai",
  "human",
  "supervisor_override",
]);

export const editTypeEnum = pgEnum("edit_type", [
  "create",
  "resize",
  "delete",
  "split",
  "merge",
  "classify",
  "bulk",
]);

export const taskTypeEnum = pgEnum("task_type", [
  "tag_session_bounds",
  "verify_states",
  "verify_intents",
  "tag_backchannels",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "assigned",
  "in_progress",
  "submitted",
  "under_review",
  "approved",
  "rejected",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "paused",
  "completed",
  "archived",
]);

// --- Tables ---

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  role: userRoleEnum("role").notNull().default("annotator"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  status: projectStatusEnum("status").notNull().default("active"),
  guidelines: text("guidelines"),
  guidelinesUpdatedAt: timestamp("guidelines_updated_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: projectMemberRoleEnum("role").notNull().default("annotator"),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
  ],
);

export const videos = pgTable("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  s3Key: text("s3_key").notNull().unique(),
  durationSecs: real("duration_secs"),
  status: videoStatusEnum("status").notNull().default("uploading"),
  uploadMetadata: jsonb("upload_metadata"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    stage: pipelineStageEnum("stage").notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    progress: real("progress").notNull().default(0),
    resultS3Key: text("result_s3_key"),
    errorMessage: text("error_message"),
    triggerJobId: text("trigger_job_id"),
    modalCallId: text("modal_call_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("processing_jobs_video_stage_idx").on(t.videoId, t.stage),
  ],
);

export const annotationSets = pgTable(
  "annotation_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    type: annotationSetTypeEnum("type").notNull(),
    version: integer("version").notNull().default(1),
    data: jsonb("data").notNull(),
    metadata: jsonb("metadata"),
    source: annotationSourceEnum("source").notNull().default("ai"),
    createdBy: uuid("created_by").references(() => profiles.id),
    isCurrent: boolean("is_current").notNull().default(false),
    isApproved: boolean("is_approved").notNull().default(false),
    approvedBy: uuid("approved_by").references(() => profiles.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("annotation_sets_video_type_version_idx").on(
      t.videoId,
      t.type,
      t.version,
    ),
    uniqueIndex("annotation_sets_current_idx")
      .on(t.videoId, t.type)
      .where(sql`is_current = true`),
  ],
);

export const annotationEdits = pgTable("annotation_edits", {
  id: uuid("id").primaryKey().defaultRandom(),
  annotationSetId: uuid("annotation_set_id")
    .notNull()
    .references(() => annotationSets.id, { onDelete: "cascade" }),
  editType: editTypeEnum("edit_type").notNull(),
  targetIndex: integer("target_index"),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  userId: uuid("user_id").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    taskType: taskTypeEnum("task_type").notNull(),
    status: taskStatusEnum("status").notNull().default("pending"),
    assignedTo: uuid("assigned_to").references(() => profiles.id),
    priority: integer("priority").notNull().default(0),
    constraints: jsonb("constraints"),
    timeSpentSecs: real("time_spent_secs"),
    editCount: integer("edit_count"),
    reviewedBy: uuid("reviewed_by").references(() => profiles.id),
    reviewNotes: text("review_notes"),
    reviewResult: text("review_result"),
    triggerWaitToken: text("trigger_wait_token"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "tasks_review_result_check",
      sql`${t.reviewResult} IN ('approved', 'rejected')`,
    ),
  ],
);

export const annotatorMetrics = pgTable(
  "annotator_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    tasksCompleted: integer("tasks_completed").notNull().default(0),
    tasksRejected: integer("tasks_rejected").notNull().default(0),
    avgTimeSecs: real("avg_time_secs"),
    avgEditCount: real("avg_edit_count"),
    kappaScore: real("kappa_score"),
    boundaryIou: real("boundary_iou"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("annotator_metrics_user_project_period_idx").on(
      t.userId,
      t.projectId,
      t.periodStart,
      t.periodEnd,
    ),
  ],
);
