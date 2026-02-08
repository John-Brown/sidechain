CREATE TYPE "public"."annotation_set_type" AS ENUM('state', 'intent', 'backchannel', 'session_bounds', 'transcription');--> statement-breakpoint
CREATE TYPE "public"."annotation_source" AS ENUM('ai', 'human', 'supervisor_override');--> statement-breakpoint
CREATE TYPE "public"."edit_type" AS ENUM('create', 'resize', 'delete', 'split', 'merge', 'classify', 'bulk');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('vad', 'transcription', 'facial_tracking', 'mouth_energy', 'diarization', 'state_annotation', 'intent_classification');--> statement-breakpoint
CREATE TYPE "public"."project_member_role" AS ENUM('admin', 'supervisor', 'annotator');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'assigned', 'in_progress', 'submitted', 'under_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('tag_session_bounds', 'verify_states', 'verify_intents', 'tag_backchannels');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'supervisor', 'annotator');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('uploading', 'uploaded', 'processing', 'ready', 'error');--> statement-breakpoint
CREATE TABLE "annotation_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"annotation_set_id" uuid NOT NULL,
	"edit_type" "edit_type" NOT NULL,
	"target_index" integer,
	"before_state" jsonb,
	"after_state" jsonb,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annotation_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"type" "annotation_set_type" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"metadata" jsonb,
	"source" "annotation_source" DEFAULT 'ai' NOT NULL,
	"created_by" uuid,
	"is_current" boolean DEFAULT false NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "annotator_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"tasks_rejected" integer DEFAULT 0 NOT NULL,
	"avg_time_secs" real,
	"avg_edit_count" real,
	"kappa_score" real,
	"boundary_iou" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"stage" "pipeline_stage" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"result_s3_key" text,
	"error_message" text,
	"trigger_job_id" text,
	"modal_call_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'annotator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "project_member_role" DEFAULT 'annotator' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"task_type" "task_type" NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"constraints" jsonb,
	"time_spent_secs" real,
	"edit_count" integer,
	"reviewed_by" uuid,
	"review_notes" text,
	"review_result" text,
	"trigger_wait_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "tasks_review_result_check" CHECK ("tasks"."review_result" IN ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"s3_key" text NOT NULL,
	"duration_secs" real,
	"status" "video_status" DEFAULT 'uploading' NOT NULL,
	"upload_metadata" jsonb,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_s3_key_unique" UNIQUE("s3_key")
);
--> statement-breakpoint
ALTER TABLE "annotation_edits" ADD CONSTRAINT "annotation_edits_annotation_set_id_annotation_sets_id_fk" FOREIGN KEY ("annotation_set_id") REFERENCES "public"."annotation_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_edits" ADD CONSTRAINT "annotation_edits_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_sets" ADD CONSTRAINT "annotation_sets_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_sets" ADD CONSTRAINT "annotation_sets_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_sets" ADD CONSTRAINT "annotation_sets_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotator_metrics" ADD CONSTRAINT "annotator_metrics_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotator_metrics" ADD CONSTRAINT "annotator_metrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "annotation_sets_video_type_version_idx" ON "annotation_sets" USING btree ("video_id","type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "annotation_sets_current_idx" ON "annotation_sets" USING btree ("video_id","type") WHERE is_current = true;--> statement-breakpoint
CREATE UNIQUE INDEX "annotator_metrics_user_project_period_idx" ON "annotator_metrics" USING btree ("user_id","project_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_jobs_video_stage_idx" ON "processing_jobs" USING btree ("video_id","stage");