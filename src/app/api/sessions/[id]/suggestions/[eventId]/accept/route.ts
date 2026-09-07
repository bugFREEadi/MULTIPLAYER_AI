import { jsonError, requireAppUser } from "@/lib/auth";
import { requireSessionPermission } from "@/lib/rbac";
import { acceptSuggestion } from "@/lib/suggestions";

type RouteContext = {
  params: Promise<{ id: string; eventId: string }>;
};

/**
 * POST /api/sessions/:id/suggestions/:eventId/accept
 * Pilot/owner accepts → user_message + streamed agent reply.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId, eventId } = await context.params;
    await requireSessionPermission(user, sessionId, "suggestion.resolve");

    await request.text().catch(() => "");

    return acceptSuggestion({
      sessionId,
      suggestionEventId: eventId,
      actorId: user.id,
    });
  } catch (error) {
    return jsonError(error);
  }
}
