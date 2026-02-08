---
paths:
  - "apps/web/src/lib/components/viewer/**"
  - "apps/web/src/lib/server/trpc/**"
  - "packages/shared/src/**"
---

# AI-First Architecture

This platform is designed for LLM agents as first-class users alongside humans. Every feature that mutates state must be accessible through a structured command interface — not just through UI event handlers.

## Core Principle: Command Layer

All state mutations flow through a **command → executor** pattern. UI and agent/NL inputs both produce the same command objects.

```
UI event ─────┐
              ├→ AnnotationCommand → CommandExecutor → state mutation → undo + dirty + audit
NL / Agent ──┘
```

**Never** couple an edit operation directly to a pointer/keyboard handler. The handler's job is to produce a command; the executor's job is to apply it.

## Command Schema (`packages/shared`)

Commands are serializable, input-modality-agnostic:

```typescript
type AnnotationCommand =
  | { action: 'select'; target: AnnotationTarget }
  | { action: 'create'; annotationType: AnnotationSetType; timeRange: TimeRange; fields: Record<string, unknown> }
  | { action: 'resize'; target: AnnotationTarget; timeRange: TimeRange }
  | { action: 'delete'; target: AnnotationTarget }
  | { action: 'split'; target: AnnotationTarget; splitTime: number }
  | { action: 'merge'; targets: [AnnotationTarget, AnnotationTarget] }
  | { action: 'classify'; target: AnnotationTarget; fields: Record<string, unknown> }
  | { action: 'bulk'; commands: AnnotationCommand[] }
```

## Semantic Targeting

Targets resolve to concrete indices, but can be specified semantically:

```typescript
type AnnotationTarget =
  | { by: 'index'; annotationType: AnnotationSetType; index: number }        // UI: click/drag
  | { by: 'id'; annotationId: string }                                       // stable reference
  | { by: 'time'; annotationType: AnnotationSetType; time: number }          // "at 12 seconds"
  | { by: 'timeRange'; annotationType: AnnotationSetType; range: TimeRange } // "between 10-20s"
  | { by: 'selected' }                                                       // "the selected one"
  | { by: 'query'; annotationType: AnnotationSetType; filter: TargetFilter } // "all short listening segments"
```

A `resolveTarget()` function converts any target form to `{ annotationType, indices: number[] }`. This is the bridge between NL (semantic) and operations (index-based).

## Command Executor Responsibilities

The executor centralizes what would otherwise be scattered across handlers:

1. **Resolve** target → concrete indices via `resolveTarget()`
2. **Validate** bounds, overlaps, permissions, task constraints
3. **Execute** pure operation function from `editing/operations.ts`
4. **Apply** result to editorState
5. **Snapshot** push undo history
6. **Dirty** mark affected annotation type
7. **Audit** log the command itself (not just the diff)
8. **Return** structured `CommandResult` with description (for agent feedback)

## CommandResult (agent-friendly feedback)

```typescript
type CommandResult =
  | { ok: true; changed: { type: AnnotationSetType; indices: number[] }; description: string }
  | { ok: false; error: string; suggestedFix?: string }
```

Errors must include `suggestedFix` when possible — the agent needs actionable recovery, not just a status code.

## Dual Execution Paths

- **Client-side**: `executeCommand(editorState, annotationData, cmd)` — real-time, drives UI
- **Server-side**: `annotations.execute` tRPC procedure — accepts same command schema, loads state from DB, applies, persists. This is the agent API entry point.

Both paths use the same `resolveTarget()`, validation, and operation functions.

## tRPC Agent Surface

Agent-facing procedures should:
- Accept `AnnotationCommand` (Zod-validated) as input
- Return `CommandResult` with `description` (not just success/fail)
- Include `availableActions` in query responses — the agent should know what it can do next
- Use structured errors with `suggestedFix` — never bare `BAD_REQUEST`
- Support idempotency keys for retryable mutations
- Support batch commands via `{ action: 'bulk', commands: [...] }`

## State Observation for Agents

Query endpoints must expose enough state for an agent to reason:

- Current annotations within a time range, filterable by type/source/confidence
- Pipeline status per stage
- Task queue state (assigned, available, blocked)
- Coverage gaps and validation status
- What actions are available given current state + permissions

## Design Checklist

When building any feature that creates, modifies, or deletes annotation data:

- [ ] Is the operation expressed as an `AnnotationCommand`?
- [ ] Does the UI handler produce a command (not call operations directly)?
- [ ] Can an agent trigger the same operation via tRPC without a browser?
- [ ] Does the result include a human/agent-readable `description`?
- [ ] Are errors structured with `suggestedFix`?
- [ ] Is the target resolvable from semantic descriptors (time, query), not just index?
