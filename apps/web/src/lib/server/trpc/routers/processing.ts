import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { videos, processingJobs, projectMembers } from "@annotation/db";
import { PIPELINE_STAGES } from "@annotation/shared";
import type { PipelineStage } from "@annotation/shared";
import { protectedProcedure, router } from "../trpc.js";
import { getObject } from "../../s3.js";
import { createCachedS3Getter } from "../../s3-cache.js";
import { ROOT_STAGES, STAGE_RESULT_KEYS } from "../../pipeline/dag.js";
import { triggerStage, triggerReadyStages } from "../../pipeline/trigger.js";

const cachedGetObject = createCachedS3Getter(getObject);

export const processingRouter = router({
  triggerPipeline: protectedProcedure
    .input(z.object({ videoId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
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

      // Create all 7 job rows as pending (upsert to handle retries)
      const jobInserts = PIPELINE_STAGES.map((stage) => ({
        videoId: video.id,
        stage: stage as PipelineStage,
        status: "pending" as const,
        progress: 0,
        resultS3Key: `results/${video.id}/${STAGE_RESULT_KEYS[stage as PipelineStage]}`,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      }));

      const createdJobs = [];
      for (const values of jobInserts) {
        const [job] = await ctx.db
          .insert(processingJobs)
          .values(values)
          .onConflictDoUpdate({
            target: [processingJobs.videoId, processingJobs.stage],
            set: {
              status: "pending",
              progress: 0,
              errorMessage: null,
              startedAt: null,
              completedAt: null,
              resultS3Key: values.resultS3Key,
            },
          })
          .returning();
        createdJobs.push(job);
      }

      // Invalidate S3 cache for all stages being re-triggered
      for (const job of createdJobs) {
        if (job.resultS3Key) cachedGetObject.invalidate(job.resultS3Key);
      }

      // Update video status to processing
      await ctx.db
        .update(videos)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(videos.id, video.id));

      // Fire root stages concurrently (non-blocking).
      // Modal endpoints are synchronous (block until done), so we don't await —
      // the mutation returns immediately and the frontend polls for status.
      for (const stage of ROOT_STAGES) {
        const job = createdJobs.find((j) => j.stage === stage);
        if (job) {
          triggerStage(ctx.db, video.id, video.s3Key, stage, job.id)
            .then(() => {
              // After a root stage completes, trigger any newly unblocked stages
              return triggerReadyStages(ctx.db, video.id, video.s3Key);
            })
            .catch((err) => console.error(`Stage ${stage} trigger error:`, err));
        }
      }

      return createdJobs;
    }),

  retryStage: protectedProcedure
    .input(z.object({
      videoId: z.string().uuid(),
      stage: z.enum(PIPELINE_STAGES),
    }))
    .mutation(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
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

      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      const { stage } = input;
      const resultS3Key = `results/${video.id}/${STAGE_RESULT_KEYS[stage]}`;

      // Reset the job to pending
      const [job] = await ctx.db
        .insert(processingJobs)
        .values({
          videoId: video.id,
          stage,
          status: "pending",
          resultS3Key,
        })
        .onConflictDoUpdate({
          target: [processingJobs.videoId, processingJobs.stage],
          set: {
            status: "pending",
            progress: 0,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
          },
        })
        .returning();

      // Invalidate S3 cache for the retried stage
      cachedGetObject.invalidate(resultS3Key);

      // Fire-and-forget with cascade
      triggerStage(ctx.db, video.id, video.s3Key, stage, job.id)
        .then(() => triggerReadyStages(ctx.db, video.id, video.s3Key))
        .catch((err) => console.error(`Retry ${stage} error:`, err));

      return job;
    }),

  getJobStatus: protectedProcedure
    .input(z.object({ videoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
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

      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      return ctx.db
        .select()
        .from(processingJobs)
        .where(eq(processingJobs.videoId, input.videoId))
        .orderBy(processingJobs.createdAt);
    }),

  getResults: protectedProcedure
    .input(z.object({
      videoId: z.string().uuid(),
      stage: z.enum(PIPELINE_STAGES),
    }))
    .query(async ({ ctx, input }) => {
      const [job] = await ctx.db
        .select()
        .from(processingJobs)
        .where(
          and(
            eq(processingJobs.videoId, input.videoId),
            eq(processingJobs.stage, input.stage),
          ),
        )
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "No processing job found" });
      if (job.status !== "completed" || !job.resultS3Key) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Job is not completed (status: ${job.status})` });
      }

      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
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

      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      return cachedGetObject.get(job.resultS3Key);
    }),

  getAllResults: protectedProcedure
    .input(z.object({ videoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
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

      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });

      const allJobs = await ctx.db
        .select()
        .from(processingJobs)
        .where(eq(processingJobs.videoId, input.videoId))
        .orderBy(processingJobs.createdAt);

      const jobStatuses = allJobs.map((j) => ({ stage: j.stage, status: j.status }));

      // Fetch results for completed jobs, excluding facial_tracking (too large)
      const completedJobs = allJobs.filter(
        (j) => j.status === "completed" && j.resultS3Key && j.stage !== "facial_tracking",
      );

      const resultEntries = await Promise.all(
        completedJobs.map(async (j) => {
          try {
            const data = await cachedGetObject.get(j.resultS3Key!);
            return [j.stage, data] as const;
          } catch (err) {
            console.error(`[getAllResults] Failed to fetch ${j.stage} from S3 (key: ${j.resultS3Key}):`, err);
            return [j.stage, null] as const;
          }
        }),
      );

      const results: Record<string, unknown> = {};
      for (const [stage, data] of resultEntries) {
        if (data !== null) {
          results[stage] = data;
        }
      }

      return { results, jobStatuses };
    }),
});
