import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { extractPlaybookFromSession } from "@/lib/playbooks";
import { requireSessionPermission } from "@/lib/rbac";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/sessions/:id/extract-playbook — "Make this repeatable"
 * Creates a workflow_patterns row with created_from_session_id set.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await params;
    await requireSessionPermission(user, id, "members.manage", null);

    let name: string | null = null;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as {
        name?: unknown;
      } | null;
      if (body?.name != null) {
        if (typeof body.name !== "string") {
          return Response.json(
            { error: "name must be a string" },
            { status: 400 }
          );
        }
        name = body.name.trim() || null;
      }
    }

    const { pattern, extraction } = await extractPlaybookFromSession({
      orgId: user.orgId,
      sessionId: id,
      actorId: user.id,
      name,
    });

    return Response.json({ pattern, extraction }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
