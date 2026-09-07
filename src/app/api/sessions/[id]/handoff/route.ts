import { jsonError, requireAppUser } from "@/lib/auth";
import { generateHandoffBrief } from "@/lib/handoff";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/sessions/:id/handoff
 * On-demand handoff brief — summarizes events since the last handoff_brief
 * (or session start) and appends via the Step 8 fan-out sequencer.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "session.handoff");

    const event = await generateHandoffBrief({
      sessionId,
      actorId: user.id,
      trigger: "on_demand",
    });

    return Response.json({ event }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
