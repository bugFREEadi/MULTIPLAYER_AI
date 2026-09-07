import { jsonError, requireActor } from "@/lib/auth";
import { runAgentTurn } from "@/lib/agent-loop";
import { assertOrgBudgetAllowsNewWork } from "@/lib/budget";
import { maybeRaiseCheckpointForUserMessage } from "@/lib/checkpoints";
import { appendSessionEvent, listSessionEvents } from "@/lib/events";
import { requireSessionPermission } from "@/lib/rbac";
import { requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** GET /api/sessions/:id/events?since=N — events with sequence_number > N (default 0). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id: sessionId } = await context.params;
    await requireSessionAccess(actor.user, sessionId, actor.guestSessionId);

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

    const events = await listSessionEvents(sessionId, since);
    return Response.json({ events });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/sessions/:id/events — append a user_message, then run the
 * single-agent loop which appends an agent_message via the same sequencer.
 * Keyword policies may raise a checkpoint and skip the agent turn.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id: sessionId } = await context.params;
    const { session } = await requireSessionPermission(
      actor.user,
      sessionId,
      "user_message.write",
      actor.guestSessionId
    );

    await assertOrgBudgetAllowsNewWork(session.orgId);

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

    const payload = body.payload as Record<string, unknown>;
    const content =
      typeof payload.content === "string" ? payload.content.trim() : "";

    const event = await appendSessionEvent({
      sessionId,
      eventType: "user_message",
      actorId: actor.user.id,
      actorType: "human",
      payload,
    });

    const { paused, checkpoint } = await maybeRaiseCheckpointForUserMessage({
      sessionId,
      orgId: session.orgId,
      actorId: actor.user.id,
      userMessageEvent: event,
      content,
    });

    if (paused) {
      return Response.json(
        { event, checkpoint, paused: true, agentEvent: null },
        { status: 201 }
      );
    }

    const turn = await runAgentTurn(sessionId);
    if (turn.paused) {
      return Response.json(
        {
          event,
          checkpoint: turn.checkpoint,
          paused: true,
          agentEvent: null,
        },
        { status: 201 }
      );
    }

    return Response.json(
      { event, agentEvent: turn.event, paused: false },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
