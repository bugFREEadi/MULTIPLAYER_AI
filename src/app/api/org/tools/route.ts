import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  ensureOrgTool,
  isSupportedToolName,
  listOrgTools,
  SUPPORTED_TOOLS,
} from "@/lib/tool-mesh";
import { githubOAuthConfigured } from "@/lib/github-oauth";

/**
 * GET /api/org/tools — connected tools + available connectors.
 * POST — ensure a tool stub exists (for permission toggles before OAuth).
 */
export async function GET() {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }

    const tools = await listOrgTools(user.orgId);
    return Response.json({
      tools,
      available: SUPPORTED_TOOLS.map((name) => ({
        toolName: name,
        oauthConfigured: name === "github" ? githubOAuthConfigured() : false,
      })),
    });
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
      tool_name?: unknown;
    } | null;

    if (!body || typeof body.tool_name !== "string" || !isSupportedToolName(body.tool_name)) {
      return Response.json(
        { error: 'tool_name must be a supported tool (currently "github")' },
        { status: 400 }
      );
    }

    await ensureOrgTool(user.orgId, body.tool_name);
    const tools = await listOrgTools(user.orgId);
    return Response.json({ tools }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
