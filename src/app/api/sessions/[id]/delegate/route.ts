import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  getTaskGraphForSession,
  planDelegation,
} from "@/lib/manager-agent";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/sessions/:id/delegate — latest task graph for this parent session.
 * POST — submit a goal; Manager Agent plans (mock decomposition in mock mode).
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "session.handoff");

    const bundle = await getTaskGraphForSession(sessionId);
    return Response.json({
      graph: bundle?.graph ?? null,
      nodes: bundle?.nodes ?? [],
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    const { session } = await requireSessionPermission(
      user,
      sessionId,
      "session.handoff"
    );
    if (!session.orgId) {
      throw new AuthError("Session has no organization", 400);
    }

    const body = (await request.json().catch(() => null)) as {
      goal?: unknown;
    } | null;
    if (!body || typeof body.goal !== "string" || !body.goal.trim()) {
      return Response.json({ error: "goal is required" }, { status: 400 });
    }

    const result = await planDelegation({
      parentSessionId: sessionId,
      orgId: session.orgId,
      userId: user.id,
      goal: body.goal,
    });

    return Response.json(
      {
        graph: result.graph,
        nodes: result.nodes,
        recalledFacts: result.recalledFacts,
      },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
