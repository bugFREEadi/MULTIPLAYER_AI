import { jsonError, requireAppUser } from "@/lib/auth";
import { raiseManualCheckpoint } from "@/lib/checkpoints";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/sessions/:id/checkpoints
 * Body: { policy_id?: string } — raise an active manual policy (optional id).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    const { session } = await requireSessionPermission(
      user,
      sessionId,
      "checkpoint.raise_manual"
    );

    if (!session.orgId) {
      return Response.json(
        { error: "Session has no organization" },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      policy_id?: unknown;
    } | null;

    const policyId =
      body && typeof body.policy_id === "string" ? body.policy_id : undefined;

    const checkpoint = await raiseManualCheckpoint({
      sessionId,
      orgId: session.orgId,
      actorId: user.id,
      policyId,
    });

    return Response.json({ event: checkpoint, paused: true }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
