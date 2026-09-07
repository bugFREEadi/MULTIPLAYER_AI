import { jsonError, requireAppUser } from "@/lib/auth";
import { runAgentTurn } from "@/lib/agent-loop";
import { resolveCheckpoint } from "@/lib/checkpoints";
import { requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string; eventId: string }>;
};

/**
 * POST /api/sessions/:id/checkpoints/:eventId/resolve
 * Body: { decision: "approve" | "reject" }
 * Only the checkpoint's required_role may resolve.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId, eventId } = await context.params;
    const { membership } = await requireSessionAccess(user, sessionId);

    const body = (await request.json().catch(() => null)) as {
      decision?: unknown;
    } | null;

    if (
      !body ||
      (body.decision !== "approve" && body.decision !== "reject")
    ) {
      return Response.json(
        { error: 'decision must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    const { resolved, shouldRunAgent, approvedToolEvent } =
      await resolveCheckpoint({
      sessionId,
      checkpointEventId: eventId,
      actorId: user.id,
      actorRole: membership.role,
      decision: body.decision,
    });

    let agentEvent = approvedToolEvent;
    let paused = false;
    let checkpoint = null;
    if (shouldRunAgent) {
      const turn = await runAgentTurn(sessionId);
      agentEvent = turn.event;
      paused = turn.paused;
      checkpoint = turn.checkpoint;
    }

    return Response.json({
      event: resolved,
      agentEvent,
      resumed: !paused,
      paused,
      checkpoint,
    });
  } catch (error) {
    return jsonError(error);
  }
}
