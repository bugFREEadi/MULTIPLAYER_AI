import { jsonError, requireAppUser } from "@/lib/auth";
import { getSessionCostTotal } from "@/lib/budget";
import { requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** GET /api/sessions/:id/cost — running sum(cost_usd) for the session. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionAccess(user, sessionId);

    const cost = await getSessionCostTotal(sessionId);
    return Response.json(cost);
  } catch (error) {
    return jsonError(error);
  }
}
