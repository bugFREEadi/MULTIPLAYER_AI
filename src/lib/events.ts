import { and, asc, eq, gt, max, lte } from "drizzle-orm";
import { db } from "@/db";
import { sessionEvents, sessions } from "@/db/schema";
import { AuthError } from "@/lib/auth-error";
import { publishSessionEvent } from "@/lib/realtime";

export type SessionEventRow = typeof sessionEvents.$inferSelect;

export type AppendSessionEventInput = {
  sessionId: string;
  eventType: string;
  actorId: string | null;
  actorType: "human" | "agent";
  payload: Record<string, unknown>;
  tokenUsage?: Record<string, unknown> | null;
  costUsd?: string | null;
};

/**
 * Atomic event append — the single sequencing code path for this project.
 * Locks the sessions row (SELECT … FOR UPDATE), then assigns max(seq)+1.
 * For branches, seq continues after forked_from_event_seq (no event copy).
 * After commit, publishes to Redis `session:{id}` for live fan-out (Step 8).
 */
export async function appendSessionEvent(
  input: AppendSessionEventInput
): Promise<SessionEventRow> {
  const created = await db.transaction(async (tx) => {
    const locked = await tx
      .select({
        id: sessions.id,
        forkedFromEventSeq: sessions.forkedFromEventSeq,
      })
      .from(sessions)
      .where(eq(sessions.id, input.sessionId))
      .for("update");

    if (locked.length === 0) {
      throw new AuthError("Session not found", 404);
    }

    const [agg] = await tx
      .select({ maxSeq: max(sessionEvents.sequenceNumber) })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, input.sessionId));

    const forkFloor = locked[0].forkedFromEventSeq ?? 0;
    const sequenceNumber =
      Math.max(Number(agg?.maxSeq ?? 0), forkFloor) + 1;

    const [row] = await tx
      .insert(sessionEvents)
      .values({
        sessionId: input.sessionId,
        sequenceNumber,
        eventType: input.eventType,
        actorId: input.actorId,
        actorType: input.actorType,
        payload: input.payload,
        tokenUsage: input.tokenUsage ?? null,
        costUsd: input.costUsd ?? null,
      })
      .returning();

    return row;
  });

  await publishSessionEvent(created);
  return created;
}

/** Events physically stored on this session row only (no parent walk). */
export async function listOwnSessionEvents(sessionId: string, since = 0) {
  return db
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessionId),
        gt(sessionEvents.sequenceNumber, since)
      )
    )
    .orderBy(asc(sessionEvents.sequenceNumber));
}

/**
 * Timeline read for a session — walks parent ancestry for events at or before
 * each fork point, then appends this session's own events. Does not copy rows.
 */
export async function listSessionEvents(sessionId: string, since = 0) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new AuthError("Session not found", 404);
  }

  if (!session.parentSessionId || session.forkedFromEventSeq == null) {
    return listOwnSessionEvents(sessionId, since);
  }

  const forkSeq = session.forkedFromEventSeq;
  const inherited = await listSessionEvents(session.parentSessionId, since);
  const inheritedUpToFork = inherited.filter(
    (event) => event.sequenceNumber <= forkSeq
  );
  const own = await listOwnSessionEvents(sessionId, since);

  const byId = new Map<string, SessionEventRow>();
  for (const event of inheritedUpToFork) {
    byId.set(event.id, event);
  }
  for (const event of own) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
}

/** Own events up to a sequence number (used when validating fork points). */
export async function listOwnEventsUpTo(sessionId: string, maxSeq: number) {
  return db
    .select()
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, sessionId),
        lte(sessionEvents.sequenceNumber, maxSeq)
      )
    )
    .orderBy(asc(sessionEvents.sequenceNumber));
}
