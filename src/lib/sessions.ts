import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessionMembers, sessions, users } from "@/db/schema";
import { AuthError } from "@/lib/auth-error";
import type { AppUser, ActorContext } from "@/lib/auth";
import { appendSessionEvent } from "@/lib/events";
import {
  assertGuestSessionScope,
  isGuestClerkId,
} from "@/lib/guest-auth";

export type SessionRow = typeof sessions.$inferSelect;
export type MembershipRow = typeof sessionMembers.$inferSelect;

export type SessionMemberPublic = {
  userId: string;
  role: string;
  name: string | null;
  email: string | null;
  isGuest: boolean | null;
};

/**
 * Membership is the access grant. Guests are additionally constrained to:
 * - the single session on their magic-link cookie
 * - client_facing visibility only (internal_only never accessible)
 */
export async function requireSessionAccess(
  user: AppUser,
  sessionId: string,
  guestSessionId?: string | null
) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new AuthError("Session not found", 404);
  }

  const guest = isGuestClerkId(user.clerkId) || Boolean(guestSessionId);
  if (guest) {
    if (guestSessionId) {
      assertGuestSessionScope(guestSessionId, sessionId);
    }
    if (session.visibility === "internal_only") {
      throw new AuthError(
        "Forbidden: internal_only sessions are not visible to guests",
        403
      );
    }
  }

  const [membership] = await db
    .select()
    .from(sessionMembers)
    .where(
      and(
        eq(sessionMembers.sessionId, sessionId),
        eq(sessionMembers.userId, user.id)
      )
    )
    .limit(1);

  if (!membership) {
    throw new AuthError("Forbidden: not a member of this session", 403);
  }

  if (membership.isGuest && session.visibility === "internal_only") {
    throw new AuthError(
      "Forbidden: internal_only sessions are not visible to guests",
      403
    );
  }

  return { session, membership };
}

export async function requireActorSessionAccess(
  actor: ActorContext,
  sessionId: string
) {
  return requireSessionAccess(userOrActor(actor), sessionId, actor.guestSessionId);
}

function userOrActor(actor: ActorContext | AppUser): AppUser {
  return "user" in actor && actor.user ? actor.user : (actor as AppUser);
}

export async function listSessionMembers(
  sessionId: string
): Promise<SessionMemberPublic[]> {
  const rows = await db
    .select({
      userId: sessionMembers.userId,
      role: sessionMembers.role,
      isGuest: sessionMembers.isGuest,
      name: users.name,
      email: users.email,
    })
    .from(sessionMembers)
    .innerJoin(users, eq(users.id, sessionMembers.userId))
    .where(eq(sessionMembers.sessionId, sessionId));

  return rows.map((row) => ({
    userId: row.userId,
    role: row.role,
    name: row.name,
    email: row.email,
    isGuest: row.isGuest,
  }));
}

/**
 * Promote caller to active pilot; demote any other pilot → co_pilot.
 * Owner keeps the `owner` role but is recorded as active pilot in the event.
 * Broadcasts `role_change` via appendSessionEvent → Redis fan-out.
 */
export async function takeSessionControl(opts: {
  sessionId: string;
  actor: AppUser;
}): Promise<{
  members: SessionMemberPublic[];
  roleChangeEvent: Awaited<ReturnType<typeof appendSessionEvent>>;
}> {
  const { sessionId, actor } = opts;

  if (isGuestClerkId(actor.clerkId)) {
    throw new AuthError("Guests cannot take control", 403);
  }

  const result = await db.transaction(async (tx) => {
    const members = await tx
      .select()
      .from(sessionMembers)
      .where(eq(sessionMembers.sessionId, sessionId));

    const actorRow = members.find((m) => m.userId === actor.id);
    if (!actorRow) {
      throw new AuthError("Forbidden: not a member of this session", 403);
    }

    const previousPilots = members.filter((m) => m.role === "pilot");
    const previousPilotUserId =
      previousPilots.find((m) => m.userId !== actor.id)?.userId ??
      previousPilots[0]?.userId ??
      null;

    const changes: Array<{
      user_id: string;
      from: string;
      to: string;
    }> = [];

    for (const pilot of previousPilots) {
      if (pilot.userId === actor.id) continue;
      await tx
        .update(sessionMembers)
        .set({ role: "co_pilot" })
        .where(
          and(
            eq(sessionMembers.sessionId, sessionId),
            eq(sessionMembers.userId, pilot.userId)
          )
        );
      changes.push({
        user_id: pilot.userId,
        from: "pilot",
        to: "co_pilot",
      });
    }

    // Owner stays owner; everyone else who takes control becomes pilot.
    if (actorRow.role !== "owner" && actorRow.role !== "pilot") {
      await tx
        .update(sessionMembers)
        .set({ role: "pilot" })
        .where(
          and(
            eq(sessionMembers.sessionId, sessionId),
            eq(sessionMembers.userId, actor.id)
          )
        );
      changes.push({
        user_id: actor.id,
        from: actorRow.role,
        to: "pilot",
      });
    } else if (actorRow.role === "owner" && previousPilotUserId === actor.id) {
      // already the only pilot-equivalent; still emit for UI sync
    }

    return {
      previousPilotUserId:
        previousPilotUserId === actor.id ? null : previousPilotUserId,
      changes,
    };
  });

  const roleChangeEvent = await appendSessionEvent({
    sessionId,
    eventType: "role_change",
    actorId: actor.id,
    actorType: "human",
    payload: {
      action: "take_control",
      new_pilot_user_id: actor.id,
      previous_pilot_user_id: result.previousPilotUserId,
      changes: result.changes,
    },
  });

  const members = await listSessionMembers(sessionId);
  return { members, roleChangeEvent };
}
