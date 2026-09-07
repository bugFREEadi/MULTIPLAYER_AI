import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessionMembers, users } from "@/db/schema";
import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { isSessionRole, requireSessionPermission } from "@/lib/rbac";
import { listSessionMembers, requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** GET /api/sessions/:id/members — participant list for role badges. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionAccess(user, sessionId);
    const members = await listSessionMembers(sessionId);
    return Response.json({ members });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/sessions/:id/members
 * Body: { clerk_id: string, role: string }
 * Adds (or updates) a member — needed so non-pilots can join and post suggestions.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "members.manage");

    const body = (await request.json().catch(() => null)) as {
      clerk_id?: unknown;
      role?: unknown;
    } | null;

    if (!body || typeof body.clerk_id !== "string" || !body.clerk_id.trim()) {
      return Response.json(
        { error: "clerk_id must be a non-empty string" },
        { status: 400 }
      );
    }

    if (typeof body.role !== "string" || !isSessionRole(body.role)) {
      return Response.json(
        {
          error:
            "role must be one of owner|pilot|co_pilot|reviewer|observer|auditor",
        },
        { status: 400 }
      );
    }

    const [target] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, body.clerk_id.trim()))
      .limit(1);

    if (!target) {
      throw new AuthError(
        "User not found — they must sign in (or hit an API) once first",
        404
      );
    }

    const [existing] = await db
      .select()
      .from(sessionMembers)
      .where(
        and(
          eq(sessionMembers.sessionId, sessionId),
          eq(sessionMembers.userId, target.id)
        )
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(sessionMembers)
        .set({ role: body.role })
        .where(
          and(
            eq(sessionMembers.sessionId, sessionId),
            eq(sessionMembers.userId, target.id)
          )
        )
        .returning();
      return Response.json({ member: updated });
    }

    const [created] = await db
      .insert(sessionMembers)
      .values({
        sessionId,
        userId: target.id,
        role: body.role,
      })
      .returning();

    return Response.json({ member: created }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
