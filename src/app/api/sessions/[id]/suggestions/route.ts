import { jsonError, requireAppUser } from "@/lib/auth";
import { appendSessionEvent } from "@/lib/events";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/sessions/:id/suggestions
 * Body: { content: string }
 * Reviewer proposes a next message (observers are read-only).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "suggestion.write");

    const body = (await request.json().catch(() => null)) as {
      content?: unknown;
    } | null;

    if (!body || typeof body.content !== "string" || !body.content.trim()) {
      return Response.json(
        { error: "content must be a non-empty string" },
        { status: 400 }
      );
    }

    const event = await appendSessionEvent({
      sessionId,
      eventType: "suggestion",
      actorId: user.id,
      actorType: "human",
      payload: { content: body.content.trim() },
    });

    return Response.json({ event }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
