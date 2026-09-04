import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessionMembers, sessions } from "@/db/schema";
import { AuthError, type AppUser } from "@/lib/auth";

export type SessionRow = typeof sessions.$inferSelect;
export type MembershipRow = typeof sessionMembers.$inferSelect;

const WRITE_ROLES = new Set(["owner", "pilot", "co_pilot"]);

export async function requireSessionAccess(user: AppUser, sessionId: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new AuthError("Session not found", 404);
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

  if (user.orgId && session.orgId && session.orgId !== user.orgId) {
    throw new AuthError(
      "Forbidden: session belongs to another organization",
      403
    );
  }

  return { session, membership };
}

export function canWriteUserMessage(role: string) {
  return WRITE_ROLES.has(role);
}
