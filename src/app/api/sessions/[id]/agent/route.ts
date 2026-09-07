import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { bindSessionAgent } from "@/lib/agents";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * PUT /api/sessions/:id/agent — bind session to a Fleet agent (or clear with null).
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    const { session } = await requireSessionPermission(
      user,
      sessionId,
      "user_message.write"
    );
    if (!user.orgId || !session.orgId) {
      throw new AuthError("Session has no organization", 400);
    }

    const body = (await request.json().catch(() => null)) as {
      agent_id?: unknown;
    } | null;

    if (!body || !("agent_id" in body)) {
      return Response.json(
        { error: "agent_id is required (string or null)" },
        { status: 400 }
      );
    }

    if (body.agent_id !== null && typeof body.agent_id !== "string") {
      return Response.json(
        { error: "agent_id must be a string or null" },
        { status: 400 }
      );
    }

    const updated = await bindSessionAgent({
      sessionId,
      orgId: session.orgId,
      agentId: body.agent_id,
    });

    return Response.json({ session: updated });
  } catch (error) {
    return jsonError(error);
  }
}
