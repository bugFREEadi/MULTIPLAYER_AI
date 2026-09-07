import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  createAgent,
  listAgentsWithMetrics,
} from "@/lib/agents";

/**
 * GET /api/org/agents — list fleet agents with performance rollups
 * POST — create agent
 */
export async function GET() {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const agents = await listAgentsWithMetrics(user.orgId);
    return Response.json({ agents });
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
      version?: unknown;
      model_provider?: unknown;
      model_id?: unknown;
      system_prompt?: unknown;
    } | null;

    if (!body || typeof body.name !== "string") {
      return Response.json({ error: "name is required" }, { status: 400 });
    }
    if (typeof body.version !== "string") {
      return Response.json({ error: "version is required" }, { status: 400 });
    }
    if (typeof body.model_provider !== "string") {
      return Response.json(
        { error: "model_provider is required" },
        { status: 400 }
      );
    }
    if (typeof body.model_id !== "string") {
      return Response.json({ error: "model_id is required" }, { status: 400 });
    }

    const agent = await createAgent({
      orgId: user.orgId,
      name: body.name,
      version: body.version,
      modelProvider: body.model_provider,
      modelId: body.model_id,
      systemPrompt:
        typeof body.system_prompt === "string" ? body.system_prompt : null,
      ownerId: user.id,
    });

    return Response.json({ agent }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
