import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { videos, processingJobs, projectMembers } from "@annotation/db";
import { VIDEO_LANGUAGES } from "@annotation/shared";
import { protectedProcedure, router } from "../trpc.js";
import {
  createMultipartUpload,
  getUploadPartUrl,
  completeMultipartUpload,
  getPresignedDownloadUrl,
  deleteS3Object,
  deleteS3Prefix,
} from "../../s3.js";

export const videosRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify user is a member of the project
      const [membership] = await ctx.db
        .select()
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

      return ctx.db
        .select()
        .from(videos)
        .where(eq(videos.projectId, input.projectId))
        .orderBy(videos.createdAt);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.id))
        .limit(1);

      if (!video) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
      }

      // Verify project membership
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
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to access this video" });
      }

      const jobs = await ctx.db
        .select()
        .from(processingJobs)
        .where(eq(processingJobs.videoId, video.id))
        .orderBy(processingJobs.createdAt);

      return { ...video, processingJobs: jobs };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        filename: z.string().min(1).max(255).optional(),
        metadata: z
          .object({
            description: z.string().max(2000).optional(),
            tags: z.array(z.string().max(50)).max(20).optional(),
            speakerCount: z.number().int().min(1).max(100).optional(),
            language: z.enum(VIDEO_LANGUAGES).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.id))
        .limit(1);

      if (!video) throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });

      // Verify project membership
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

      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (input.filename !== undefined) {
        updates.filename = input.filename;
      }

      if (input.metadata !== undefined) {
        // Merge with existing metadata (partial update)
        const existing =
          (video.uploadMetadata as Record<string, unknown>) ?? {};
        updates.uploadMetadata = { ...existing, ...input.metadata };
      }

      const [updated] = await ctx.db
        .update(videos)
        .set(updates)
        .where(eq(videos.id, input.id))
        .returning();

      return updated;
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        filename: z.string().min(1),
        s3Key: z.string().min(1),
        durationSecs: z.number().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [membership] = await ctx.db
        .select()
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

      const [video] = await ctx.db
        .insert(videos)
        .values({
          projectId: input.projectId,
          filename: input.filename,
          s3Key: input.s3Key,
          durationSecs: input.durationSecs ?? null,
          status: "uploading",
          uploadedBy: ctx.user.id,
        })
        .returning();

      return video;
    }),

  getUploadUrls: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        contentType: z.string(),
        partCount: z.number().int().min(1).max(10000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
        .limit(1);

      if (!video) throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });

      // Verify ownership
      if (video.uploadedBy !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }

      const uploadId = await createMultipartUpload(
        video.s3Key,
        input.contentType,
      );

      const partUrls = await Promise.all(
        Array.from({ length: input.partCount }, (_, i) =>
          getUploadPartUrl(video.s3Key, uploadId, i + 1),
        ),
      );

      return { uploadId, partUrls };
    }),

  completeUpload: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        uploadId: z.string(),
        parts: z.array(
          z.object({
            ETag: z.string(),
            PartNumber: z.number().int(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
        .limit(1);

      if (!video) throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
      if (video.uploadedBy !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }

      await completeMultipartUpload(video.s3Key, input.uploadId, input.parts);

      const [updated] = await ctx.db
        .update(videos)
        .set({ status: "uploaded", updatedAt: new Date() })
        .where(eq(videos.id, input.videoId))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.id))
        .limit(1);

      if (!video) throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });

      // Verify project membership
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

      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      // Delete S3 objects: the video file + any results
      await Promise.all([
        deleteS3Object(video.s3Key),
        deleteS3Prefix(`results/${video.id}/`),
      ]);

      // Delete DB row (cascades to processing_jobs, annotation_sets)
      await ctx.db.delete(videos).where(eq(videos.id, input.id));

      return { success: true };
    }),

  getStreamUrl: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.id))
        .limit(1);

      if (!video) throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });

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

      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to access this video" });

      const url = await getPresignedDownloadUrl(video.s3Key);
      return { url };
    }),
});
