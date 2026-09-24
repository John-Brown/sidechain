import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  annotationSets,
  annotationEdits,
  videos,
  projectMembers,
  tasks,
} from "@annotation/db";
import type { Database } from "@annotation/db";
import {
  ANNOTATION_SET_TYPES,
  EDIT_TYPES,
} from "@annotation/shared";
import type { TaskConstraints } from "@annotation/shared";
import { protectedProcedure, router } from "../trpc.js";
import { assertEditsAllowed, assertTaskAllowsSave, stampReviews } from "../annotation-save-rules.js";

// --- Helpers ---

/**
 * Verify user can save annotations for this video.
 * Enforces task constraints when a task exists, or role-based access otherwise.
 */
async function validateSavePermissions(
  db: Database,
  userId: string,
  videoId: string,
  type: (typeof ANNOTATION_SET_TYPES)[number],
  taskId: string | undefined,
) {
  // Look up the video and verify project membership
  const [video] = await db
    .select({ id: videos.id, projectId: videos.projectId })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  if (!video) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
  }

  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, video.projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this project" });
  }

  // If taskId provided, validate task constraints
  if (taskId) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
    }

    // Same video, in progress, assigned to the caller, type editable
    assertTaskAllowsSave(task, { userId, videoId, type });

    return { membership, task };
  }

  // Without a task, annotators must work through tasks
  if (membership.role === "annotator") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Annotators must work through tasks",
    });
  }

  return { membership, task: null };
}

// --- Input schemas ---

/**
 * One audit-trail record. A "confirm" (a human accepted an AI prediction
 * unchanged) must name the item and carry its after-state, which holds the
 * `review` stamp; that stamp is what persists the confirmation (it lives in
 * the saved `data`), the edit row is the audit of who confirmed what.
 */
const editRecordSchema = z
  .object({
    editType: z.enum(EDIT_TYPES),
    targetIndex: z.number().int().nullable(),
    beforeState: z.unknown().nullable(),
    afterState: z.unknown().nullable(),
  })
  .superRefine((edit, ctx) => {
    if (edit.editType !== "confirm") return;
    if (edit.targetIndex === null || edit.targetIndex < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetIndex"],
        message: "confirm edits must target an item index",
      });
    }
    const review = (edit.afterState as { review?: { confirmed?: unknown } } | null)?.review;
    if (!review || review.confirmed !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["afterState"],
        message: "confirm edits must carry the confirmed item (review.confirmed = true)",
      });
    }
  });

// --- Router ---

export const annotationsRouter = router({
  /**
   * Save annotation data — creates a new version of the annotation_set.
   * Transaction: set is_current=false on old → insert new with is_current=true → batch insert edits.
   *
   * With `taskId` (the viewer sends it in task mode) the task's constraints
   * are enforced; without it annotators are refused. Per-item `review` stamps
   * are server-owned: unchanged items keep the previous version's `by` / `at`,
   * new ones get the caller and the server clock, and a new
   * `supervisor_override` needs an admin or supervisor; an annotator may only
   * restore one an earlier version stored on that exact item
   * (annotation-save-rules.ts).
   */
  save: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        type: z.enum(ANNOTATION_SET_TYPES),
        data: z.unknown(),
        metadata: z.unknown().optional(),
        taskId: z.string().uuid().optional(),
        edits: z.array(editRecordSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { membership, task } = await validateSavePermissions(
        ctx.db,
        ctx.user.id,
        input.videoId,
        input.type,
        input.taskId,
      );

      // Task constraints: every recorded operation must be allowed
      assertEditsAllowed(input.edits, task?.constraints as TaskConstraints | null);

      return await ctx.db.transaction(async (tx) => {
        // 1. Find current version (if any)
        const [current] = await tx
          .select({
            id: annotationSets.id,
            version: annotationSets.version,
            metadata: annotationSets.metadata,
            data: annotationSets.data,
          })
          .from(annotationSets)
          .where(
            and(
              eq(annotationSets.videoId, input.videoId),
              eq(annotationSets.type, input.type),
              eq(annotationSets.isCurrent, true),
            ),
          )
          .limit(1);

        const nextVersion = current ? current.version + 1 : 1;

        // Review stamps: unchanged items keep the previous by/at, new ones get the
        // caller and server time, supervisor_override is role-checked
        const data = await stampReviews(input.data, current?.data, {
          userId: ctx.user.id,
          role: membership.role,
          now: new Date().toISOString(),
          // An annotator's undo can restore an item an earlier version stored
          // with a supervisor stamp: allowed only if this exact item (stamp,
          // by and at included) is in some version of this video and type
          stampExistsInHistory: async (item) => {
            const [hit] = await tx
              .select({ id: annotationSets.id })
              .from(annotationSets)
              .where(
                and(
                  eq(annotationSets.videoId, input.videoId),
                  eq(annotationSets.type, input.type),
                  // Exact element equality, not containment (`@>` would accept a subset,
                  // e.g. the stamp with by/at or content fields stripped)
                  sql`CASE WHEN jsonb_typeof(${annotationSets.data}) = 'array' THEN EXISTS (SELECT 1 FROM jsonb_array_elements(${annotationSets.data}) AS e(v) WHERE e.v = ${JSON.stringify(item)}::jsonb) ELSE false END`,
                ),
              )
              .limit(1);
            return hit !== undefined;
          },
        });

        // 2. Set is_current=false on existing current version
        if (current) {
          await tx
            .update(annotationSets)
            .set({ isCurrent: false })
            .where(eq(annotationSets.id, current.id));
        }

        // 3. Insert new annotation_set with is_current=true
        const [newSet] = await tx
          .insert(annotationSets)
          .values({
            videoId: input.videoId,
            type: input.type,
            version: nextVersion,
            data,
            // Carry the previous version's metadata forward when the client sends none
            metadata: input.metadata ?? current?.metadata ?? null,
            source: "human",
            createdBy: ctx.user.id,
            isCurrent: true,
          })
          .returning();

        // 4. Batch insert annotation_edits
        if (input.edits.length > 0) {
          await tx.insert(annotationEdits).values(
            input.edits.map((edit) => ({
              annotationSetId: newSet.id,
              editType: edit.editType,
              targetIndex: edit.targetIndex,
              beforeState: edit.beforeState,
              afterState: edit.afterState,
              userId: ctx.user.id,
            })),
          );
        }

        return {
          id: newSet.id,
          version: newSet.version,
          createdAt: newSet.createdAt,
        };
      });
    }),

  /**
   * Get the current annotation_set for a video+type.
   */
  get: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        type: z.enum(ANNOTATION_SET_TYPES),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify project membership via video
      const [video] = await ctx.db
        .select({ projectId: videos.projectId })
        .from(videos)
        .where(eq(videos.id, input.videoId))
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

      const [annotationSet] = await ctx.db
        .select()
        .from(annotationSets)
        .where(
          and(
            eq(annotationSets.videoId, input.videoId),
            eq(annotationSets.type, input.type),
            eq(annotationSets.isCurrent, true),
          ),
        )
        .limit(1);

      return annotationSet ?? null;
    }),

  /**
   * List all versions for a video+type, most recent first.
   */
  listVersions: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        type: z.enum(ANNOTATION_SET_TYPES),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select({ projectId: videos.projectId })
        .from(videos)
        .where(eq(videos.id, input.videoId))
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

      return ctx.db
        .select({
          id: annotationSets.id,
          version: annotationSets.version,
          source: annotationSets.source,
          isCurrent: annotationSets.isCurrent,
          isApproved: annotationSets.isApproved,
          createdBy: annotationSets.createdBy,
          createdAt: annotationSets.createdAt,
        })
        .from(annotationSets)
        .where(
          and(
            eq(annotationSets.videoId, input.videoId),
            eq(annotationSets.type, input.type),
          ),
        )
        .orderBy(desc(annotationSets.version));
    }),

  /**
   * Revert to a specific version — marks that version as current (creates a new version row with the old data).
   */
  revert: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        type: z.enum(ANNOTATION_SET_TYPES),
        targetVersionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Only admin/supervisor can revert
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

      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this project" });
      }

      if (membership.role === "annotator") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins and supervisors can revert versions" });
      }

      // Fetch the target version
      const [target] = await ctx.db
        .select()
        .from(annotationSets)
        .where(
          and(
            eq(annotationSets.id, input.targetVersionId),
            eq(annotationSets.videoId, input.videoId),
            eq(annotationSets.type, input.type),
          ),
        )
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Target version not found" });
      }

      return await ctx.db.transaction(async (tx) => {
        // Find current version
        const [current] = await tx
          .select({ id: annotationSets.id, version: annotationSets.version })
          .from(annotationSets)
          .where(
            and(
              eq(annotationSets.videoId, input.videoId),
              eq(annotationSets.type, input.type),
              eq(annotationSets.isCurrent, true),
            ),
          )
          .limit(1);

        const nextVersion = current ? current.version + 1 : 1;

        // Unset current
        if (current) {
          await tx
            .update(annotationSets)
            .set({ isCurrent: false })
            .where(eq(annotationSets.id, current.id));
        }

        // Insert new version with the target's data
        const [newSet] = await tx
          .insert(annotationSets)
          .values({
            videoId: input.videoId,
            type: input.type,
            version: nextVersion,
            data: target.data,
            metadata: target.metadata,
            source: "supervisor_override",
            createdBy: ctx.user.id,
            isCurrent: true,
          })
          .returning();

        // Record the revert as a bulk edit
        await tx.insert(annotationEdits).values({
          annotationSetId: newSet.id,
          editType: "bulk",
          targetIndex: null,
          beforeState: null,
          afterState: { revertedFrom: current?.version, revertedTo: target.version },
          userId: ctx.user.id,
        });

        return {
          id: newSet.id,
          version: newSet.version,
          createdAt: newSet.createdAt,
        };
      });
    }),
});
