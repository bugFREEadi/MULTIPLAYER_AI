import { jsonError, requireAppUser } from "@/lib/auth";
import { requireSessionPermission } from "@/lib/rbac";
import { takeSessionControl } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/sessions/:id/take-control
 * Caller becomes active pilot; previous pilot → co_pilot; broadcasts role_change.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "session.take_control");

    const { members, roleChangeEvent } = await takeSessionControl({
      sessionId,
      actor: user,
    });

    return Response.json({ members, event: roleChangeEvent });
  } catch (error) {
    return jsonError(error);
  }
}
