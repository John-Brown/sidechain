import { z } from "zod";
import { eq } from "drizzle-orm";
import { projects, projectMembers } from "@annotation/db";
import { protectedProcedure, router } from "../trpc.js";

export const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        createdAt: projects.createdAt,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.userId, ctx.user.id));
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
