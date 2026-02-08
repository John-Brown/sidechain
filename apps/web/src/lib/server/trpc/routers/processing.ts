import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { videos, processingJobs, projectMembers } from "@annotation/db";
import { protectedProcedure, router } from "../trpc.js";
import { getObject } from "../../s3.js";

const MODAL_ENDPOINT = process.env.MODAL_ENDPOINT_URL;
const PROCESSING_SECRET = process.env.PROCESSING_CALLBACK_SECRET;

export const processingRouter = router({
  triggerVAD: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
      }),
    )
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

      const resultS3Key = `results/${video.id}/vad.json`;

      // Insert the job as pending
      const [job] = await ctx.db
        .insert(processingJobs)
        .values({
          videoId: video.id,
          stage: "vad",
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
            createdAt: new Date(),
          },
        })
        .returning();

      // POST to Modal web endpoint
      if (!MODAL_ENDPOINT) {
        throw new Error("MODAL_ENDPOINT_URL not configured");
      }

      try {
        const callbackUrl = process.env.PUBLIC_APP_URL
          ? `${process.env.PUBLIC_APP_URL}/api/processing/callback`
          : undefined;

        const res = await fetch(MODAL_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: job.id,
            video_s3_key: video.s3Key,
            result_s3_key: resultS3Key,
            callback_url: callbackUrl,
            callback_secret: PROCESSING_SECRET,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          await ctx.db
            .update(processingJobs)
            .set({ status: "failed", errorMessage: `Modal returned ${res.status}: ${text}` })
            .where(eq(processingJobs.id, job.id));
          throw new Error(`Failed to trigger Modal: ${res.status}`);
        }

        const body = (await res.json()) as { call_id?: string };

        // Update to running
        const [updated] = await ctx.db
          .update(processingJobs)
          .set({
            status: "running",
            startedAt: new Date(),
            modalCallId: body.call_id ?? null,
          })
          .where(eq(processingJobs.id, job.id))
          .returning();

        return updated;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Failed to trigger Modal")) {
          throw err;
        }
        // Network/fetch error
        await ctx.db
          .update(processingJobs)
          .set({ status: "failed", errorMessage: String(err) })
          .where(eq(processingJobs.id, job.id));
        throw new Error(`Failed to contact Modal endpoint: ${err}`);
      }
    }),

  getJobStatus: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(processingJobs)
        .where(eq(processingJobs.videoId, input.videoId))
        .orderBy(processingJobs.createdAt);
    }),

  getResults: protectedProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        stage: z.enum([
          "vad",
          "transcription",
          "facial_tracking",
          "mouth_energy",
          "diarization",
          "state_annotation",
          "intent_classification",
        ]),
      }),
    )
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

      // Verify project membership via video
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
