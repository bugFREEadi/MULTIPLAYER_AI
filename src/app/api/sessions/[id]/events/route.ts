import { and, asc, eq, gt, max } from "drizzle-orm";
import { db } from "@/db";
import { sessionEvents, sessions } from "@/db/schema";
import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { canWriteUserMessage, requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** GET /api/sessions/:id/events?since=N — events with sequence_number > N (default 0). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionAccess(user, sessionId);

    const { searchParams } = new URL(request.url);
    const sinceParam = searchParams.get("since");
    let since = 0;
    if (sinceParam != null && sinceParam !== "") {
      since = Number(sinceParam);
      if (!Number.isInteger(since) || since < 0) {
        return Response.json(
          { error: "since must be a non-negative integer" },
          { status: 400 }
        );
      }
    }

    const events = await db
      .select()
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sessionId),
          gt(sessionEvents.sequenceNumber, since)
        )
      )
      .orderBy(asc(sessionEvents.sequenceNumber));

    return Response.json({ events });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/sessions/:id/events — append a user_message.
 * sequence_number is assigned under a row lock on sessions so concurrent
 * appends cannot collide or leave gaps.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    const { membership } = await requireSessionAccess(user, sessionId);

    if (!canWriteUserMessage(membership.role)) {
      throw new AuthError(
        "Forbidden: role cannot append user_message events",
        403
      );
    }

    const body = (await request.json().catch(() => null)) as {
      event_type?: unknown;
      payload?: unknown;
    } | null;

    if (!body || body.event_type !== "user_message") {
      return Response.json(
        { error: "Only event_type 'user_message' is accepted on this endpoint" },
        { status: 400 }
      );
    }

    if (
      body.payload == null ||
      typeof body.payload !== "object" ||
      Array.isArray(body.payload)
    ) {
      return Response.json(
        { error: "payload must be a JSON object" },
        { status: 400 }
      );
    }

    const event = await db.transaction(async (tx) => {
      // Serialize appends for this session (also verifies the session still exists).
      const locked = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .for("update");

      if (locked.length === 0) {
        throw new AuthError("Session not found", 404);
      }

      const [agg] = await tx
        .select({ maxSeq: max(sessionEvents.sequenceNumber) })
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId));

      const sequenceNumber = (agg?.maxSeq ?? 0) + 1;

      const [created] = await tx
        .insert(sessionEvents)
        .values({
          sessionId,
          sequenceNumber,
          eventType: "user_message",
          actorId: user.id,
          actorType: "human",
          payload: body.payload,
        })
        .returning();

      return created;
    });

    return Response.json({ event }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
