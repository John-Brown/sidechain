import { z } from "zod";
import { eq, and, count, desc } from "drizzle-orm";
import {
  projects,
  projectMembers,
  profiles,
  videos,
  processingJobs,
  tasks,
} from "@annotation/db";
import { TRPCError } from "@trpc/server";
import type { Database } from "@annotation/db";
import { protectedProcedure, router } from "../trpc.js";

// --- Helpers ---

async function requireMembership(
  db: Database,
  projectId: string,
  userId: string,
  requiredRoles?: ("admin" | "supervisor" | "annotator")[],
) {
  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this project",
    });
  }

  if (requiredRoles && !requiredRoles.includes(membership.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This action requires one of: ${requiredRoles.join(", ")}`,
    });
  }

  return membership;
}

// --- Router ---

export const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        status: projects.status,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.userId, ctx.user.id));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireMembership(
        ctx.db,
        input.id,
        ctx.user.id,
      );

      const [project] = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id))
        .limit(1);

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      return { ...project, role: membership.role };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .insert(projects)
        .values({
          name: input.name,
          description: input.description ?? null,
          createdBy: ctx.user.id,
        })
        .returning();

      await ctx.db.insert(projectMembers).values({
        projectId: project.id,
        userId: ctx.user.id,
        role: "admin",
      });

      return project;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        status: z.enum(["active", "paused", "completed", "archived"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, input.id, ctx.user.id, ["admin"]);

      const { id, ...updates } = input;
      const setValues: Record<string, unknown> = { updatedAt: new Date() };
      if (updates.name !== undefined) setValues.name = updates.name;
      if (updates.description !== undefined) setValues.description = updates.description;
      if (updates.status !== undefined) setValues.status = updates.status;

      const [updated] = await ctx.db
        .update(projects)
        .set(setValues)
        .where(eq(projects.id, id))
        .returning();

      return updated;
    }),

  updateGuidelines: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        guidelines: z.string().max(50000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, input.projectId, ctx.user.id, [
        "admin",
        "supervisor",
      ]);

      const now = new Date();
      const [updated] = await ctx.db
        .update(projects)
        .set({
          guidelines: input.guidelines || null,
          guidelinesUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(projects.id, input.projectId))
        .returning({ guidelinesUpdatedAt: projects.guidelinesUpdatedAt });

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, input.id, ctx.user.id, ["admin"]);

      await ctx.db.delete(projects).where(eq(projects.id, input.id));
      return { success: true };
    }),

  listMembers: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx.db, input.projectId, ctx.user.id);

      return ctx.db
        .select({
          userId: projectMembers.userId,
          displayName: profiles.displayName,
          email: profiles.email,
          role: projectMembers.role,
          addedAt: projectMembers.addedAt,
        })
        .from(projectMembers)
        .innerJoin(profiles, eq(projectMembers.userId, profiles.id))
        .where(eq(projectMembers.projectId, input.projectId));
    }),

  addMember: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(["admin", "supervisor", "annotator"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, input.projectId, ctx.user.id, ["admin"]);

      // Look up profile by email
      const [profile] = await ctx.db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.email, input.email))
        .limit(1);

      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No user found with that email. They must sign up first.",
        });
      }

      // Check if already a member
      const [existing] = await ctx.db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, profile.id),
          ),
        )
        .limit(1);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this project",
        });
      }

      const [member] = await ctx.db
        .insert(projectMembers)
        .values({
          projectId: input.projectId,
          userId: profile.id,
          role: input.role,
        })
        .returning();

      return member;
    }),

  updateMemberRole: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["admin", "supervisor", "annotator"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, input.projectId, ctx.user.id, ["admin"]);

      // If demoting from admin, check we won't leave zero admins
      const [currentMembership] = await ctx.db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, input.userId),
          ),
        )
        .limit(1);

      if (!currentMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      if (currentMembership.role === "admin" && input.role !== "admin") {
        const [{ adminCount }] = await ctx.db
          .select({ adminCount: count() })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, input.projectId),
              eq(projectMembers.role, "admin"),
            ),
          );

        if (adminCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot demote the last admin",
          });
        }
      }

      const [updated] = await ctx.db
        .update(projectMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, input.userId),
          ),
        )
        .returning();

      return updated;
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        userId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, input.projectId, ctx.user.id, ["admin"]);

      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove yourself. Use leave project instead.",
        });
      }

      // Check if removing the target would leave zero admins
      const [targetMembership] = await ctx.db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, input.userId),
          ),
        )
        .limit(1);

      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      if (targetMembership.role === "admin") {
        const [{ adminCount }] = await ctx.db
          .select({ adminCount: count() })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, input.projectId),
              eq(projectMembers.role, "admin"),
            ),
          );

        if (adminCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last admin",
          });
        }
      }

      await ctx.db
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, input.userId),
          ),
        );

      return { success: true };
    }),

  dashboard: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx.db, input.projectId, ctx.user.id);

      const [videoStats, jobStats, taskStats, recentVideos] = await Promise.all([
        // Video count by status
        ctx.db
          .select({
            status: videos.status,
            count: count(),
          })
          .from(videos)
          .where(eq(videos.projectId, input.projectId))
          .groupBy(videos.status),

        // Job count by status (join through videos)
        ctx.db
          .select({
            status: processingJobs.status,
            count: count(),
          })
          .from(processingJobs)
          .innerJoin(videos, eq(processingJobs.videoId, videos.id))
          .where(eq(videos.projectId, input.projectId))
          .groupBy(processingJobs.status),

        // Task count by status (join through videos)
        ctx.db
          .select({
            status: tasks.status,
            count: count(),
          })
          .from(tasks)
          .innerJoin(videos, eq(tasks.videoId, videos.id))
          .where(eq(videos.projectId, input.projectId))
          .groupBy(tasks.status),

        // Recent videos
        ctx.db
          .select({
            id: videos.id,
            filename: videos.filename,
            status: videos.status,
            createdAt: videos.createdAt,
          })
          .from(videos)
          .where(eq(videos.projectId, input.projectId))
          .orderBy(desc(videos.createdAt))
          .limit(5),
      ]);

      const videosByStatus: Record<string, number> = {};
      let videoCount = 0;
      for (const row of videoStats) {
        videosByStatus[row.status] = row.count;
        videoCount += row.count;
      }

      const jobsByStatus: Record<string, number> = {};
      for (const row of jobStats) {
        jobsByStatus[row.status] = row.count;
      }

      const tasksByStatus: Record<string, number> = {};
      for (const row of taskStats) {
        tasksByStatus[row.status] = row.count;
      }

      return {
        videoCount,
        videosByStatus,
        jobsByStatus,
        tasksByStatus,
        recentVideos,
      };
    }),

  getOrCreateDefault: protectedProcedure.mutation(async ({ ctx }) => {
    const existing = await ctx.db
      .select({ id: projects.id, name: projects.name })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.userId, ctx.user.id))
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    const [project] = await ctx.db
      .insert(projects)
      .values({
        name: "My Project",
        description: "Default project",
        createdBy: ctx.user.id,
      })
      .returning();

    await ctx.db.insert(projectMembers).values({
      projectId: project.id,
      userId: ctx.user.id,
      role: "admin",
    });

    return project;
  }),
});
