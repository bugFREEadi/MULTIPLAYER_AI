import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { setCheckpointPolicyActive } from "@/lib/checkpoints";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * PATCH /api/org/checkpoint-policies/:id
 * Body: { active: boolean } — toggle a policy.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      active?: unknown;
    } | null;

    if (!body || typeof body.active !== "boolean") {
      return Response.json({ error: "active must be a boolean" }, { status: 400 });
    }

    const policy = await setCheckpointPolicyActive(user.orgId, id, body.active);
    return Response.json({ policy });
  } catch (error) {
    return jsonError(error);
  }
}
