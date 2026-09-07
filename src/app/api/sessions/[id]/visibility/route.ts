import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { setSessionVisibility } from "@/lib/guest-auth";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * PATCH /api/sessions/:id/visibility — internal_only | client_facing
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "members.manage");

    const body = (await request.json().catch(() => null)) as {
      visibility?: unknown;
    } | null;

    if (
      !body ||
      (body.visibility !== "internal_only" &&
        body.visibility !== "client_facing")
    ) {
      return Response.json(
        { error: 'visibility must be "internal_only" or "client_facing"' },
        { status: 400 }
      );
    }

    const session = await setSessionVisibility({
      sessionId,
      orgId: user.orgId,
      visibility: body.visibility,
    });

    return Response.json({ session });
  } catch (error) {
    return jsonError(error);
  }
}
