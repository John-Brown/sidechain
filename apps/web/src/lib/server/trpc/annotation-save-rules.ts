/**
 * Pure checks behind `annotations.save` (routers/annotations.ts), kept out of
 * the router so they can be unit-tested without a database.
 *
 * - assertTaskAllowsSave: the task named by `taskId` belongs to this video, is
 *   in progress, is assigned to the caller and may edit this type.
 * - assertEditsAllowed: every recorded edit type is in the task's
 *   `allowedOperations`.
 * - stampReviews: per-item `review` stamps (AnnotationReview) are server-owned
 *   provenance. An unchanged item keeps the previous version's `by` / `at`; a
 *   new stamp gets `by` = the caller and `at` = server time. Only admins and
 *   supervisors may write a new `source: 'supervisor_override'`; an annotator
 *   may only restore one that an earlier version stored on that exact item.
 */

import { TRPCError } from "@trpc/server";
import type { AnnotationReview, AnnotationSetType, EditType, TaskConstraints, UserRole } from "@annotation/shared";

// --- Task checks ---

export interface SaveTask {
  videoId: string;
  status: string;
  assignedTo: string | null;
  constraints: unknown;
}

export function assertTaskAllowsSave(
  task: SaveTask,
  opts: { userId: string; videoId: string; type: AnnotationSetType },
): void {
  if (task.videoId !== opts.videoId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Task is for a different video" });
  }
  if (task.status !== "in_progress") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Task is not in progress" });
  }
  if (task.assignedTo !== opts.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not assigned to this task" });
  }
  const constraints = task.constraints as TaskConstraints | null;
  if (constraints?.editableTypes && !constraints.editableTypes.includes(opts.type)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Cannot edit ${opts.type} in this task` });
  }
}

/** Every recorded operation must be one the task allows (no constraints, or no allowedOperations: anything). */
export function assertEditsAllowed(
  edits: readonly { editType: EditType }[],
  constraints: TaskConstraints | null | undefined,
): void {
  const allowed = constraints?.allowedOperations;
  if (!allowed) return;
  const denied = edits.find((e) => !allowed.includes(e.editType));
  if (denied) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Operation "${denied.editType}" is not allowed in this task`,
    });
  }
}

// --- Review stamps ---

const PRIVILEGED: readonly UserRole[] = ["admin", "supervisor"];
const REVIEW_SOURCES: readonly AnnotationReview["source"][] = ["human", "supervisor_override"];

/** JSON with object keys sorted at every level (Postgres jsonb reorders keys, so plain JSON.stringify can't compare). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Item content without its stamp: the identity used to find the same item in the previous version. */
function contentKey(item: Record<string, unknown>): string {
  const { review: _review, ...rest } = item;
  return canonicalJson(rest);
}

/** content key → the stamps the previous version's items with that content carried */
function previousStamps(previous: unknown): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  if (!Array.isArray(previous)) return map;
  for (const item of previous) {
    if (!isRecord(item) || !isRecord(item.review)) continue;
    const key = contentKey(item);
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(item.review);
  }
  return map;
}

/**
 * Whether this exact item (content and `review` stamp, `by` and `at`
 * included) is stored in any earlier annotation_sets version of the same
 * video and type. The router answers it with an exact jsonb element-equality
 * query (not `@>` containment, which would match a subset); tests pass a stub.
 */
export type StampHistoryCheck = (item: Record<string, unknown>) => Promise<boolean>;

export interface StampOptions {
  userId: string;
  role: UserRole;
  /** Server time, ISO */
  now: string;
  /**
   * Lookup for a `supervisor_override` stamp an annotator sends that the
   * previous version doesn't carry (an undo restoring an older version's
   * item). Without it such a stamp is refused.
   */
  stampExistsInHistory?: StampHistoryCheck;
}

/** A well-formed AnnotationReview, or null. `by` / `at` are ignored here (the server owns them). */
function parseStamp(review: unknown): AnnotationReview | null {
  if (
    !isRecord(review) ||
    !REVIEW_SOURCES.includes(review.source as AnnotationReview["source"]) ||
    typeof review.confirmed !== "boolean" ||
    (review.origin !== undefined && typeof review.origin !== "string")
  ) {
    return null;
  }
  const stamp: AnnotationReview = {
    source: review.source as AnnotationReview["source"],
    confirmed: review.confirmed,
  };
  if (typeof review.origin === "string") stamp.origin = review.origin;
  return stamp;
}

/**
 * Validate and server-stamp the per-item `review` fields of a save.
 *
 * - **Carried over**: the previous version holds an item with the same content
 *   (review excluded) whose stamp has the same `source` and `confirmed`. The
 *   stamp keeps the previous version's `by` / `at`, whatever the client sent.
 *   The client never learns the server's values, so comparing whole stamps
 *   would re-stamp every earlier review with a new time on each save.
 * - **Restored**: an annotator (not admin/supervisor) sends a
 *   `supervisor_override` stamp that isn't carried over. That is allowed only
 *   when `stampExistsInHistory` finds this exact item, stamp included, in an
 *   earlier version (an undo of an edit that re-stamped it human), and the
 *   stamp is kept unchanged. Otherwise FORBIDDEN.
 * - **New**: anything else. It must be well formed (BAD_REQUEST otherwise),
 *   `supervisor_override` needs an admin or supervisor, and `by` / `at` are
 *   set to the caller and the server time, so a client can't attribute a
 *   review to someone else. A human item whose content changed (a resize of a
 *   reclassified item) is a new decision and gets the new time too.
 *
 * `origin` (optional string) passes through unchanged. Non-array data passes
 * through. The input is not mutated.
 */
export async function stampReviews(data: unknown, previous: unknown, opts: StampOptions): Promise<unknown> {
  if (!Array.isArray(data)) return data;
  const carried = previousStamps(previous);
  const privileged = PRIVILEGED.includes(opts.role);

  const out: unknown[] = [];
  for (let index = 0; index < data.length; index++) {
    const item = data[index];
    if (!isRecord(item) || item.review === undefined) {
      out.push(item);
      continue;
    }
    const stamp = parseStamp(item.review);
    if (!stamp) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Item ${index} has a malformed review stamp` });
    }

    const prev = carried
      .get(contentKey(item))
      ?.find((r) => r.source === stamp.source && r.confirmed === stamp.confirmed);
    if (prev) {
      const kept: AnnotationReview = { ...stamp };
      if (typeof prev.by === "string") kept.by = prev.by;
      if (typeof prev.at === "string") kept.at = prev.at;
      if (stamp.origin === undefined && typeof prev.origin === "string") kept.origin = prev.origin;
      out.push({ ...item, review: kept });
      continue;
    }

    if (stamp.source === "supervisor_override" && !privileged) {
      // A restore must carry the original attribution; a stamp without by/at can't be identical to a stored one
      const raw = item.review as Record<string, unknown>;
      const attributed = typeof raw.by === "string" && typeof raw.at === "string";
      const restored = attributed && opts.stampExistsInHistory ? await opts.stampExistsInHistory(item) : false;
      if (!restored) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins and supervisors can stamp supervisor_override reviews",
        });
      }
      out.push(item);
      continue;
    }

    out.push({ ...item, review: { ...stamp, by: opts.userId, at: opts.now } });
  }
  return out;
}
