import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { markSessionCompleted } from "@/lib/playbooks";
import { requireSessionPermission } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

/** POST /api/sessions/:id/complete — mark session completed for playbook extraction. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await params;
    await requireSessionPermission(
      user,
      id,
      "members.manage",
      null
    );

    const session = await markSessionCompleted({
      orgId: user.orgId,
      sessionId: id,
    });
    return Response.json({ session });
  } catch (error) {
    return jsonError(error);
  }
}
