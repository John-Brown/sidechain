import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray, desc } from "drizzle-orm";
import {
  tasks,
  videos,
  projectMembers,
  annotationSets,
  profiles,
} from "@annotation/db";
import {
  TASK_TYPES,
  ANNOTATION_SET_TYPES,
  EDIT_TYPES as EDIT_TYPE_VALUES,
} from "@annotation/shared";
import type { TaskConstraints } from "@annotation/shared";
import { protectedProcedure, router } from "../trpc.js";
import { putObject } from "../../s3.js";
import { triggerReadyStages } from "../../pipeline/trigger.js";

// --- Helpers ---

/** Map task types to the annotation set types they produce approved results for. */
const TASK_TYPE_TO_ANNOTATION_TYPE: Record<string, string> = {
  verify_states: "state",
  verify_intents: "intent",
  tag_session_bounds: "session_bounds",
  tag_backchannels: "backchannel",
};

/** S3 result key for approved human annotations. */
function getApprovedS3Key(videoId: string, annotationType: string): string {
  return `results/${videoId}/${annotationType}_approved.json`;
}

// --- Router ---

export const tasksRouter = router({
  /**
   * Get tasks assigned to the current user (status: assigned or in_progress).
   */
  getAssigned: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: tasks.id,
        videoId: tasks.videoId,
        taskType: tasks.taskType,
        status: tasks.status,
        priority: tasks.priority,
        constraints: tasks.constraints,
        assignedAt: tasks.assignedAt,
        startedAt: tasks.startedAt,
        videoFilename: videos.filename,
      })
      .from(tasks)
      .innerJoin(videos, eq(tasks.videoId, videos.id))
      .where(
        and(
          eq(tasks.assignedTo, ctx.user.id),
          inArray(tasks.status, ["assigned", "in_progress"]),
        ),
      )
      .orderBy(desc(tasks.priority), tasks.createdAt);
  }),

  /**
   * Get the active task for a specific video assigned to the current user.
   */
  getForVideo: protectedProcedure
    .input(z.object({ videoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.videoId, input.videoId),
            eq(tasks.assignedTo, ctx.user.id),
            inArray(tasks.status, ["assigned", "in_progress"]),
          ),
        )
        .limit(1);

      return task ?? null;
    }),

  /**
   * Get a specific task by ID, with the assignee's display name.
   */
  get: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      // Verify the user has access to this task's video project
      const [video] = await ctx.db
        .select({ projectId: videos.projectId })
        .from(videos)
        .where(eq(videos.id, task.videoId))
        .limit(1);

      if (!video) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
      }

      const [membership] = await ctx.db
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, video.projectId),
            eq(projectMembers.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this project" });
      }

      // The viewer opens someone else's task read-only and names the assignee
      let assigneeName: string | null = null;
      if (task.assignedTo) {
        const [assignee] = await ctx.db
          .select({ displayName: profiles.displayName })
          .from(profiles)
          .where(eq(profiles.id, task.assignedTo))
          .limit(1);
        assigneeName = assignee?.displayName ?? null;
      }

      return { ...task, assigneeName };
    }),

  /**
   * Start a task (assigned -> in_progress). Only the assigned user can start.
   */
  start: protectedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      if (task.assignedTo !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not assigned to this task" });
      }

      if (task.status !== "assigned") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot start task with status '${task.status}' (expected 'assigned')`,
        });
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set({ status: "in_progress", startedAt: new Date() })
        .where(eq(tasks.id, input.taskId))
        .returning();

      return updated;
    }),

  /**
   * Submit a task for review (in_progress -> submitted).
   * Records edit count and time spent.
   */
  submit: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        editCount: z.number().int().min(0),
        timeSpentSecs: z.number().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      if (task.assignedTo !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not assigned to this task" });
      }

      if (task.status !== "in_progress") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot submit task with status '${task.status}' (expected 'in_progress')`,
        });
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set({
          status: "submitted",
          submittedAt: new Date(),
          editCount: input.editCount,
          timeSpentSecs: input.timeSpentSecs,
        })
        .where(eq(tasks.id, input.taskId))
        .returning();

      return updated;
    }),

  /**
   * Supervisor review: approve or reject a submitted task.
   * On approve: exports annotation_sets.data to S3 and triggers downstream DAG stages.
   */
  review: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        result: z.enum(["approved", "rejected"]),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      if (task.status !== "submitted") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot review task with status '${task.status}' (expected 'submitted')`,
        });
      }

      // Verify reviewer is admin or supervisor on the project
      const [video] = await ctx.db
        .select({ id: videos.id, projectId: videos.projectId, s3Key: videos.s3Key })
        .from(videos)
        .where(eq(videos.id, task.videoId))
        .limit(1);

      if (!video) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
      }

      const [membership] = await ctx.db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, video.projectId),
            eq(projectMembers.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!membership || !["admin", "supervisor"].includes(membership.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins and supervisors can review tasks",
        });
      }

      if (input.result === "rejected") {
        // Rejected: send back to in_progress with reviewer notes
        const [updated] = await ctx.db
          .update(tasks)
          .set({
            status: "in_progress",
            reviewedBy: ctx.user.id,
            reviewResult: "rejected",
            reviewNotes: input.notes ?? null,
            reviewedAt: new Date(),
            // Clear submission fields so annotator can re-submit
            submittedAt: null,
          })
          .where(eq(tasks.id, input.taskId))
          .returning();

        return updated;
      }

      // Approved: export to S3 and trigger downstream
      const annotationType = TASK_TYPE_TO_ANNOTATION_TYPE[task.taskType];

      if (annotationType) {
        // Get the current annotation_set for this type
        const [currentSet] = await ctx.db
          .select()
          .from(annotationSets)
          .where(
            and(
              eq(annotationSets.videoId, task.videoId),
              eq(annotationSets.type, annotationType as any),
              eq(annotationSets.isCurrent, true),
            ),
          )
          .limit(1);

        if (currentSet) {
          // Mark annotation set as approved
          await ctx.db
            .update(annotationSets)
            .set({
              isApproved: true,
              approvedBy: ctx.user.id,
              approvedAt: new Date(),
            })
            .where(eq(annotationSets.id, currentSet.id));

          // Export to S3 in the standard envelope format
          const envelope = {
            metadata: {
              ...(currentSet.metadata as Record<string, unknown> ?? {}),
              approved_by: ctx.user.id,
              approved_at: new Date().toISOString(),
              source: "human_approved",
            },
            data: currentSet.data,
          };

          const s3Key = getApprovedS3Key(task.videoId, annotationType);
          await putObject(s3Key, JSON.stringify(envelope), "application/json");
        }
      }

      // Update task status
      const [updated] = await ctx.db
        .update(tasks)
        .set({
          status: "approved",
          reviewedBy: ctx.user.id,
          reviewResult: "approved",
          reviewNotes: input.notes ?? null,
          reviewedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning();

      // Trigger downstream DAG stages (fire-and-forget)
      triggerReadyStages(ctx.db, task.videoId, video.s3Key).catch((err) =>
        console.error(`DAG cascade after task approval error:`, err),
      );

      return updated;
    }),

  /**
   * Create a new task (supervisor/admin only).
   */
  create: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        taskType: z.enum(TASK_TYPES),
        assignedTo: z.string().uuid().optional(),
        priority: z.number().int().min(0).max(100).default(0),
        constraints: z
          .object({
            editableTypes: z.array(z.enum(ANNOTATION_SET_TYPES)),
            allowedCategories: z.array(z.string()).optional(),
            lockedTimeRanges: z
              .array(z.object({ start: z.number(), end: z.number() }))
              .optional(),
            allowedOperations: z.array(z.enum(EDIT_TYPE_VALUES)).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify video exists and user is admin/supervisor
      const [video] = await ctx.db
        .select({ projectId: videos.projectId })
        .from(videos)
        .where(eq(videos.id, input.videoId))
        .limit(1);

      if (!video) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
      }

      const [membership] = await ctx.db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, video.projectId),
            eq(projectMembers.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!membership || !["admin", "supervisor"].includes(membership.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins and supervisors can create tasks",
        });
      }

      // If assigning to someone, verify they're a project member
      if (input.assignedTo) {
        const [assignee] = await ctx.db
          .select()
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, video.projectId),
              eq(projectMembers.userId, input.assignedTo),
            ),
          )
          .limit(1);

        if (!assignee) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Assignee is not a member of this project",
          });
        }
      }

      const [task] = await ctx.db
        .insert(tasks)
        .values({
          videoId: input.videoId,
          taskType: input.taskType,
          status: input.assignedTo ? "assigned" : "pending",
          assignedTo: input.assignedTo ?? null,
          priority: input.priority,
          constraints: input.constraints ?? null,
          assignedAt: input.assignedTo ? new Date() : null,
        })
        .returning();

      return task;
    }),

  /**
   * Assign a pending task to a user (supervisor/admin only).
   */
  assign: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        assignedTo: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [task] = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      if (task.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot assign task with status '${task.status}' (expected 'pending')`,
        });
      }

      // Verify caller is admin/supervisor on the video's project
      const [video] = await ctx.db
        .select({ projectId: videos.projectId })
        .from(videos)
        .where(eq(videos.id, task.videoId))
        .limit(1);

      if (!video) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
      }

      const [membership] = await ctx.db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, video.projectId),
            eq(projectMembers.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!membership || !["admin", "supervisor"].includes(membership.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins and supervisors can assign tasks",
        });
      }

      // Verify assignee is a project member
      const [assignee] = await ctx.db
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, video.projectId),
            eq(projectMembers.userId, input.assignedTo),
          ),
        )
        .limit(1);

      if (!assignee) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Assignee is not a member of this project",
        });
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set({
          status: "assigned",
          assignedTo: input.assignedTo,
          assignedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId))
        .returning();

      return updated;
    }),

  /**
   * List tasks for a project (supervisor/admin view).
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        status: z.enum(["pending", "assigned", "in_progress", "submitted", "under_review", "approved", "rejected"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify caller is a project member
      const [membership] = await ctx.db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this project" });
      }

      const baseQuery = ctx.db
        .select({
          id: tasks.id,
          videoId: tasks.videoId,
          taskType: tasks.taskType,
          status: tasks.status,
          priority: tasks.priority,
          assignedTo: tasks.assignedTo,
          assigneeName: profiles.displayName,
          editCount: tasks.editCount,
          timeSpentSecs: tasks.timeSpentSecs,
          reviewResult: tasks.reviewResult,
          reviewNotes: tasks.reviewNotes,
          createdAt: tasks.createdAt,
          assignedAt: tasks.assignedAt,
          submittedAt: tasks.submittedAt,
          reviewedAt: tasks.reviewedAt,
          videoFilename: videos.filename,
        })
        .from(tasks)
        .innerJoin(videos, eq(tasks.videoId, videos.id))
        .leftJoin(profiles, eq(tasks.assignedTo, profiles.id))
        .where(eq(videos.projectId, input.projectId))
        .orderBy(desc(tasks.priority), tasks.createdAt);

      // If status filter provided, add it
      if (input.status) {
        return ctx.db
          .select({
            id: tasks.id,
            videoId: tasks.videoId,
            taskType: tasks.taskType,
            status: tasks.status,
            priority: tasks.priority,
            assignedTo: tasks.assignedTo,
            assigneeName: profiles.displayName,
            editCount: tasks.editCount,
            timeSpentSecs: tasks.timeSpentSecs,
            reviewResult: tasks.reviewResult,
            reviewNotes: tasks.reviewNotes,
            createdAt: tasks.createdAt,
            assignedAt: tasks.assignedAt,
            submittedAt: tasks.submittedAt,
            reviewedAt: tasks.reviewedAt,
            videoFilename: videos.filename,
          })
          .from(tasks)
          .innerJoin(videos, eq(tasks.videoId, videos.id))
          .leftJoin(profiles, eq(tasks.assignedTo, profiles.id))
          .where(
            and(
              eq(videos.projectId, input.projectId),
              eq(tasks.status, input.status),
            ),
          )
          .orderBy(desc(tasks.priority), tasks.createdAt);
      }

      return baseQuery;
    }),
});
