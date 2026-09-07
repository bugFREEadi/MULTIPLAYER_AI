import { eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { branchMerges, sessionMembers, sessions } from "@/db/schema";
import type { AppUser } from "@/lib/auth";
import { AuthError } from "@/lib/auth-error";
import { assertOrgBudgetAllowsNewWork } from "@/lib/budget";
import { SESSION_STATUS_ACTIVE } from "@/lib/checkpoints";
import { listSessionEvents } from "@/lib/events";

export type BranchMergeRow = typeof branchMerges.$inferSelect;

/**
 * Fork a session at sequence N — no event copying.
 * Branch starts active (independent of parent pause/checkpoint state).
 * Creator becomes owner on the branch.
 */
export async function createSessionBranch(opts: {
  parentSessionId: string;
  fromSequenceNumber: number;
  actor: AppUser;
}): Promise<{ session: typeof sessions.$inferSelect }> {
  const { parentSessionId, fromSequenceNumber, actor } = opts;

  if (!Number.isInteger(fromSequenceNumber) || fromSequenceNumber < 1) {
    throw new AuthError("fromSequenceNumber must be a positive integer", 400);
  }

  const [parent] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, parentSessionId))
    .limit(1);

  if (!parent) {
    throw new AuthError("Session not found", 404);
  }

  await assertOrgBudgetAllowsNewWork(parent.orgId);

  const timeline = await listSessionEvents(parentSessionId, 0);
  const forkEvent = timeline.find(
    (event) => event.sequenceNumber === fromSequenceNumber
  );
  if (!forkEvent) {
    throw new AuthError(
      `No event with sequence_number ${fromSequenceNumber} in this session`,
      400
    );
  }

  const titleBase = parent.title?.trim() || "Untitled session";
  const branchTitle = `${titleBase} (branch @ #${fromSequenceNumber})`;

  const created = await db.transaction(async (tx) => {
    const [branch] = await tx
      .insert(sessions)
      .values({
        orgId: parent.orgId,
        title: branchTitle,
        status: SESSION_STATUS_ACTIVE,
        sessionTemplate: parent.sessionTemplate,
        visibility: parent.visibility,
        parentSessionId: parent.id,
        forkedFromEventSeq: fromSequenceNumber,
        createdBy: actor.id,
      })
      .returning();

    await tx.insert(sessionMembers).values({
      sessionId: branch.id,
      userId: actor.id,
      role: "owner",
    });

    return branch;
  });

  return { session: created };
}

/**
 * Record a human merge decision — does not copy or rewrite event content.
 */
export async function recordBranchMerge(opts: {
  targetSessionId: string;
  sourceSessionId: string;
  mergedBy: string;
  mergeSummary: string;
  rejectedBranches: string[];
}): Promise<BranchMergeRow> {
  const {
    targetSessionId,
    sourceSessionId,
    mergedBy,
    mergeSummary,
    rejectedBranches,
  } = opts;

  if (!mergeSummary.trim()) {
    throw new AuthError("merge_summary is required", 400);
  }

  if (targetSessionId === sourceSessionId) {
    throw new AuthError("source and target sessions must differ", 400);
  }

  const ids = [targetSessionId, sourceSessionId, ...rejectedBranches];
  const uniqueIds = [...new Set(ids)];
  const found = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(inArray(sessions.id, uniqueIds));

  if (found.length !== uniqueIds.length) {
    throw new AuthError("One or more session ids were not found", 404);
  }

  if (rejectedBranches.includes(sourceSessionId)) {
    throw new AuthError(
      "rejected_branches must not include the source session being merged",
      400
    );
  }

  const [row] = await db
    .insert(branchMerges)
    .values({
      sourceSessionId,
      targetSessionId,
      mergedBy,
      mergeSummary: mergeSummary.trim(),
      rejectedBranches: rejectedBranches.length > 0 ? rejectedBranches : null,
    })
    .returning();

  return row;
}

export async function listChildBranches(parentSessionId: string) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.parentSessionId, parentSessionId));
}

export async function listMergesForSession(sessionId: string) {
  return db
    .select()
    .from(branchMerges)
    .where(
      or(
        eq(branchMerges.sourceSessionId, sessionId),
        eq(branchMerges.targetSessionId, sessionId)
      )
    );
}
