---
paths:
  - "apps/web/src/lib/server/trpc/**"
  - "apps/web/src/lib/trpc.ts"
---

# tRPC Conventions

## Stack

tRPC v11 + superjson transformer + Zod validation. Client requires `transformer: superjson` in httpBatchLink config.

## Context

```typescript
interface Context { db: Database; user: UserInfo | null; }
// UserInfo: { id: string; displayName: string | null; email: string | null; role: 'admin' | 'supervisor' | 'annotator' }
```

Created in `context.ts` via `createContext(event)`. Auto-creates profile for new Supabase users.

## Procedures

- `protectedProcedure` — requires auth (`ctx.user` non-null). Default for all new procedures.
- `publicProcedure` — exported from `trpc.ts` but currently unused.
- No role-gated procedure helper. Role checks happen inside handlers. `requireMembership(db, projectId, userId, requiredRoles?)` in `routers/projects.ts` is module-private. Other routers hand-roll membership queries, and `videos`/`processing` check membership only, with no role checks. Before reusing it, move it into a shared module (e.g. `trpc/authz.ts`) and export it.
- Input: always Zod schema via `.input(z.object({ ... }))`
- UUID fields: `z.string().uuid()`

## Router Registration

Add new routers in `router.ts`:
```typescript
export const appRouter = router({
  videos: videosRouter,
  processing: processingRouter,
  projects: projectsRouter,
  annotations: annotationsRouter,  // save / get / listVersions / revert
  tasks: tasksRouter,
});
```

Each router in its own file under `routers/`.

## Drizzle Query Patterns

```typescript
// Single row lookup
const [row] = await ctx.db.select().from(table).where(eq(table.id, input.id)).limit(1);
if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

// Authorization: verify project membership before returning data
const [membership] = await ctx.db.select().from(projectMembers)
  .where(and(eq(projectMembers.projectId, video.projectId), eq(projectMembers.userId, ctx.user.id)))
  .limit(1);
if (!membership) throw new TRPCError({ code: 'FORBIDDEN' });

// Transactions for multi-step writes
return await ctx.db.transaction(async (tx) => { ... });
```

## Error Handling

Use `TRPCError` with standard codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `CONFLICT` (duplicates).
