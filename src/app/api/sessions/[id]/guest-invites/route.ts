import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  createGuestInvite,
  isGuestRole,
  listGuestInvitesForSession,
} from "@/lib/guest-auth";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/sessions/:id/guest-invites — list invites for this session.
 * POST — create a magic-link invite (observer|reviewer); flips visibility to client_facing.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "members.manage");
    const invites = await listGuestInvitesForSession(sessionId);
    return Response.json({
      invites: invites.map((i) => ({
        id: i.id,
        role: i.role,
        guestOrgName: i.guestOrgName,
        expiresAt: i.expiresAt?.toISOString() ?? null,
        createdAt: i.createdAt?.toISOString() ?? null,
        redeemed: Boolean(i.redeemedUserId),
        invitePath: `/guest/invite/${i.token}`,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "members.manage");

    const body = (await request.json().catch(() => null)) as {
      role?: unknown;
      guest_org_name?: unknown;
      expires_in_hours?: unknown;
    } | null;

    if (!body || typeof body.role !== "string" || !isGuestRole(body.role)) {
      return Response.json(
        { error: 'role must be "observer" or "reviewer"' },
        { status: 400 }
      );
    }

    const result = await createGuestInvite({
      sessionId,
      orgId: user.orgId,
      createdBy: user.id,
      role: body.role,
      guestOrgName:
        typeof body.guest_org_name === "string" ? body.guest_org_name : null,
      expiresInHours:
        typeof body.expires_in_hours === "number"
          ? body.expires_in_hours
          : undefined,
    });

    const origin = new URL(request.url).origin;

    return Response.json(
      {
        invite: {
          id: result.invite.id,
          role: result.invite.role,
          guestOrgName: result.invite.guestOrgName,
          expiresAt: result.invite.expiresAt.toISOString(),
          invitePath: result.inviteUrlPath,
          inviteUrl: `${origin}${result.inviteUrlPath}`,
          token: result.token,
        },
        visibility: "client_facing",
      },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
