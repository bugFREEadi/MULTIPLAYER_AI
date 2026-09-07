import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  createCheckpointPolicy,
  listCheckpointPolicies,
  setCheckpointPolicyActive,
} from "@/lib/checkpoints";
import { isSessionRole } from "@/lib/rbac";

/**
 * GET /api/org/checkpoint-policies — list policies for the caller's org.
 * POST — create a keyword or manual policy.
 */
export async function GET() {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const policies = await listCheckpointPolicies(user.orgId);
    return Response.json({ policies });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      trigger_type?: unknown;
      trigger_config?: unknown;
      required_role?: unknown;
      active?: unknown;
    } | null;

    if (!body || typeof body.name !== "string" || !body.name.trim()) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }
    if (body.trigger_type !== "keyword" && body.trigger_type !== "manual") {
      return Response.json(
        { error: 'trigger_type must be "keyword" or "manual" in Step 10' },
        { status: 400 }
      );
    }
    if (
      body.trigger_config == null ||
      typeof body.trigger_config !== "object" ||
      Array.isArray(body.trigger_config)
    ) {
      return Response.json(
        { error: "trigger_config must be a JSON object" },
        { status: 400 }
      );
    }
    if (typeof body.required_role !== "string" || !isSessionRole(body.required_role)) {
      return Response.json(
        { error: "required_role must be a valid session role" },
        { status: 400 }
      );
    }

    const policy = await createCheckpointPolicy({
      orgId: user.orgId,
      name: body.name,
      triggerType: body.trigger_type,
      triggerConfig: body.trigger_config as Record<string, unknown>,
      requiredRole: body.required_role,
      active: typeof body.active === "boolean" ? body.active : true,
    });

    return Response.json({ policy }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
