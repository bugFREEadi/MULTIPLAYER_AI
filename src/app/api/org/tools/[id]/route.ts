import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  disconnectTool,
  isToolPermission,
  setToolPermission,
  listOrgTools,
} from "@/lib/tool-mesh";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * PATCH /api/org/tools/:id — set permission (allowed|restricted|requires_checkpoint)
 * DELETE — disconnect (clear encrypted credentials, status=disconnected)
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id: toolId } = await context.params;

    const body = (await request.json().catch(() => null)) as {
      permission?: unknown;
      agent_id?: unknown;
    } | null;

    if (
      !body ||
      typeof body.permission !== "string" ||
      !isToolPermission(body.permission)
    ) {
      return Response.json(
        {
          error:
            'permission must be "allowed", "restricted", or "requires_checkpoint"',
        },
        { status: 400 }
      );
    }

    let agentId: string | null = null;
    if (body.agent_id !== undefined && body.agent_id !== null) {
      if (typeof body.agent_id !== "string") {
        return Response.json(
          { error: "agent_id must be a string or null" },
          { status: 400 }
        );
      }
      agentId = body.agent_id;
    }

    await setToolPermission({
      orgId: user.orgId,
      toolId,
      permission: body.permission,
      agentId,
    });
    const tools = await listOrgTools(user.orgId);
    return Response.json({ tools });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id: toolId } = await context.params;
    await disconnectTool({ orgId: user.orgId, toolId });
    const tools = await listOrgTools(user.orgId);
    return Response.json({ tools });
  } catch (error) {
    return jsonError(error);
  }
}
