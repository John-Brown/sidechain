import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { videos, processingJobs, projectMembers } from "@annotation/db";
import { PIPELINE_STAGES } from "@annotation/shared";
import type { PipelineStage } from "@annotation/shared";
import { protectedProcedure, router } from "../trpc.js";
import { getObject } from "../../s3.js";
import { ROOT_STAGES, STAGE_RESULT_KEYS } from "../../pipeline/dag.js";
import { triggerStage } from "../../pipeline/trigger.js";

export const processingRouter = router({
  triggerPipeline: protectedProcedure
    .input(z.object({ videoId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
        .limit(1);

      if (!video) throw new Error("Video not found");

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

      if (!membership) throw new Error("Not authorized");

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

      // Update video status to processing
      await ctx.db
        .update(videos)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(videos.id, video.id));

      // Trigger root stages (no dependencies)
      for (const stage of ROOT_STAGES) {
        const job = createdJobs.find((j) => j.stage === stage);
        if (job) {
          await triggerStage(ctx.db, video.id, video.s3Key, stage, job.id);
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

      if (!video) throw new Error("Video not found");

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

      if (!membership) throw new Error("Not authorized");

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

      // Trigger it
      await triggerStage(ctx.db, video.id, video.s3Key, stage, job.id);

      return job;
    }),

  getJobStatus: protectedProcedure
    .input(z.object({ videoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
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

      if (!job) throw new Error("No processing job found");
      if (job.status !== "completed" || !job.resultS3Key) {
        throw new Error(`Job is not completed (status: ${job.status})`);
      }

      const [video] = await ctx.db
        .select()
        .from(videos)
        .where(eq(videos.id, input.videoId))
        .limit(1);

      if (!video) throw new Error("Video not found");

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

      if (!membership) throw new Error("Not authorized");

      return getObject(job.resultS3Key);
    }),
});
