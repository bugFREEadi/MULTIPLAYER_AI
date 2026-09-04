import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessionMembers, sessions } from "@/db/schema";
import { AuthError, jsonError, requireAppUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id } = await context.params;

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);

    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const [membership] = await db
      .select()
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.sessionId, id),
          eq(sessionMembers.userId, user.id)
        )
      )
      .limit(1);

    if (!membership) {
      throw new AuthError("Forbidden: not a member of this session", 403);
    }

    if (user.orgId && session.orgId && session.orgId !== user.orgId) {
      throw new AuthError("Forbidden: session belongs to another organization", 403);
    }

    return Response.json({
      session,
      membership: {
        role: membership.role,
        isGuest: membership.isGuest,
        guestOrgName: membership.guestOrgName,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
