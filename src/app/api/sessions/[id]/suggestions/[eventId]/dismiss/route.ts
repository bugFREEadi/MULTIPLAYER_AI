import { jsonError, requireAppUser } from "@/lib/auth";
import { requireSessionPermission } from "@/lib/rbac";
import { dismissSuggestion } from "@/lib/suggestions";

type RouteContext = {
  params: Promise<{ id: string; eventId: string }>;
};

/**
 * POST /api/sessions/:id/suggestions/:eventId/dismiss
 * Pilot/owner dismisses a suggestion (append-only marker event).
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId, eventId } = await context.params;
    await requireSessionPermission(user, sessionId, "suggestion.resolve");

    const event = await dismissSuggestion({
      sessionId,
      suggestionEventId: eventId,
      actorId: user.id,
    });

    return Response.json({ event }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
