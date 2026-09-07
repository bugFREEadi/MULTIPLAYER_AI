import { jsonError, requireAppUser } from "@/lib/auth";
import { streamAgentTurnResponse } from "@/lib/agent-loop";
import { assertOrgBudgetAllowsNewWork } from "@/lib/budget";
import { maybeRaiseCheckpointForUserMessage } from "@/lib/checkpoints";
import { appendSessionEvent } from "@/lib/events";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/sessions/:id/stream
 * Body (useCompletion): { prompt: string }
 * Appends user_message, evaluates keyword checkpoints, then streams the agent
 * reply (or returns JSON if paused on checkpoint).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    const { session } = await requireSessionPermission(
      user,
      sessionId,
      "user_message.write"
    );

    await assertOrgBudgetAllowsNewWork(session.orgId);

    const body = (await request.json().catch(() => null)) as {
      prompt?: unknown;
    } | null;

    if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
      return Response.json(
        { error: "prompt must be a non-empty string" },
        { status: 400 }
      );
    }

    const content = body.prompt.trim();

    const event = await appendSessionEvent({
      sessionId,
      eventType: "user_message",
      actorId: user.id,
      actorType: "human",
      payload: { content },
    });

    const { paused, checkpoint } = await maybeRaiseCheckpointForUserMessage({
      sessionId,
      orgId: session.orgId,
      actorId: user.id,
      userMessageEvent: event,
      content,
    });

    if (paused) {
      return Response.json(
        {
          paused: true,
          event,
          checkpoint,
          error: "Checkpoint raised — session paused until resolved",
        },
        { status: 409 }
      );
    }

    return streamAgentTurnResponse(sessionId);
  } catch (error) {
    return jsonError(error);
  }
}
