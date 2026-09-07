import { jsonError, requireActor } from "@/lib/auth";
import { permissionsForRole } from "@/lib/rbac";
import { listSessionMembers, requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const { session, membership } = await requireSessionAccess(
      actor.user,
      id,
      actor.guestSessionId
    );
    const members = await listSessionMembers(id);

    return Response.json({
      session,
      membership: {
        role: membership.role,
        isGuest: membership.isGuest,
        guestOrgName: membership.guestOrgName,
        userId: membership.userId,
      },
      permissions: permissionsForRole(membership.role),
      members,
      actorKind: actor.guestSessionId ? "guest" : "member",
    });
  } catch (error) {
    return jsonError(error);
  }
}
