import { jsonError, requireAppUser } from "@/lib/auth";
import { requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id } = await context.params;
    const { session, membership } = await requireSessionAccess(user, id);

    return Response.json({
      session,
      membership: {
        role: membership.role,
        isGuest: membership.isGuest,
        guestOrgName: membership.guestOrgName,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
