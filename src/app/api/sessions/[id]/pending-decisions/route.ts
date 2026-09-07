import { jsonError, requireAppUser } from "@/lib/auth";
import { getPendingDecisions } from "@/lib/handoff";
import { requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/sessions/:id/pending-decisions
 * Unresolved checkpoint_raised events (no matching checkpoint_resolved).
 * Read/aggregation only — no new table.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionAccess(user, sessionId);

    const data = await getPendingDecisions(sessionId);
    return Response.json(data);
  } catch (error) {
    return jsonError(error);
  }
}
