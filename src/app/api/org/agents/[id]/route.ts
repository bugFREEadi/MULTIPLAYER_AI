import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  deactivateAgent,
  getAgentMetrics,
  getOrgAgent,
  updateAgent,
} from "@/lib/agents";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/org/agents/:id — agent + metrics
 * PATCH — update fields / deactivate via status
 * DELETE — deactivate (soft)
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await context.params;
    const agent = await getOrgAgent(user.orgId, id);
    if (!agent) {
      throw new AuthError("Agent not found", 404);
    }
    const metrics = await getAgentMetrics(agent.id);
    return Response.json({ agent, metrics });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      version?: unknown;
      model_provider?: unknown;
      model_id?: unknown;
      system_prompt?: unknown;
      status?: unknown;
    } | null;

    if (!body) {
      return Response.json({ error: "JSON body required" }, { status: 400 });
    }

    const patch: {
      name?: string;
      version?: string;
      modelProvider?: string;
      modelId?: string;
      systemPrompt?: string | null;
      status?: "active" | "inactive";
    } = {};

    if (body.name != null) {
      if (typeof body.name !== "string") {
        return Response.json({ error: "name must be a string" }, { status: 400 });
      }
      patch.name = body.name;
    }
    if (body.version != null) {
      if (typeof body.version !== "string") {
        return Response.json(
          { error: "version must be a string" },
          { status: 400 }
        );
      }
      patch.version = body.version;
    }
    if (body.model_provider != null) {
      if (typeof body.model_provider !== "string") {
        return Response.json(
          { error: "model_provider must be a string" },
          { status: 400 }
        );
      }
      patch.modelProvider = body.model_provider;
    }
    if (body.model_id != null) {
      if (typeof body.model_id !== "string") {
        return Response.json(
          { error: "model_id must be a string" },
          { status: 400 }
        );
      }
      patch.modelId = body.model_id;
    }
    if (body.system_prompt !== undefined) {
      if (body.system_prompt !== null && typeof body.system_prompt !== "string") {
        return Response.json(
          { error: "system_prompt must be a string or null" },
          { status: 400 }
        );
      }
      patch.systemPrompt = body.system_prompt;
    }
    if (body.status != null) {
      if (body.status !== "active" && body.status !== "inactive") {
        return Response.json(
          { error: 'status must be "active" or "inactive"' },
          { status: 400 }
        );
      }
      patch.status = body.status;
    }

    const agent = await updateAgent({
      orgId: user.orgId,
      agentId: id,
      patch,
    });
    const metrics = await getAgentMetrics(agent.id);
    return Response.json({ agent, metrics });
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
    const { id } = await context.params;
    const agent = await deactivateAgent(user.orgId, id);
    return Response.json({ agent });
  } catch (error) {
    return jsonError(error);
  }
}
