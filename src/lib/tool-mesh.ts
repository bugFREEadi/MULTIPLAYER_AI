import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  agentToolPermissions,
  connectedTools,
  sessions,
} from "@/db/schema";
import { AuthError } from "@/lib/auth-error";
import { getOrgAgent, getSessionAgentId } from "@/lib/agents";
import {
  evaluatePolicies,
  raiseCheckpoint,
  setSessionCheckpointPaused,
  type PolicyMatch,
} from "@/lib/checkpoints";
import type { SessionEventRow } from "@/lib/events";
import { encryptJson, decryptJson, isEncryptedEnvelope } from "@/lib/crypto-secrets";

export const TOOL_PERMISSIONS = [
  "allowed",
  "restricted",
  "requires_checkpoint",
] as const;

export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];

export const SUPPORTED_TOOLS = ["github"] as const;
export type SupportedToolName = (typeof SUPPORTED_TOOLS)[number];

export function isToolPermission(value: string): value is ToolPermission {
  return (TOOL_PERMISSIONS as readonly string[]).includes(value);
}

export function isSupportedToolName(value: string): value is SupportedToolName {
  return (SUPPORTED_TOOLS as readonly string[]).includes(value);
}

export type ConnectedToolRow = typeof connectedTools.$inferSelect;
export type ToolPermissionRow = typeof agentToolPermissions.$inferSelect;

export type PublicConnectedTool = {
  id: string;
  orgId: string;
  toolName: string;
  status: string;
  createdAt: string | null;
  /** Org-default permission (agent_id IS NULL). */
  permission: ToolPermission;
  /** Per-agent overrides (Step 17). */
  agentPermissions: Array<{
    agentId: string;
    permission: ToolPermission;
  }>;
  connected: boolean;
  accountLogin: string | null;
};

function emptyEncryptedAuth() {
  return encryptJson({ placeholder: true });
}

export async function listOrgTools(orgId: string): Promise<PublicConnectedTool[]> {
  const tools = await db
    .select()
    .from(connectedTools)
    .where(eq(connectedTools.orgId, orgId));

  const perms = await db
    .select()
    .from(agentToolPermissions)
    .where(eq(agentToolPermissions.orgId, orgId));

  return tools.map((tool) => {
    const toolPerms = perms.filter((p) => p.toolId === tool.id);
    const orgDefault = toolPerms.find((p) => p.agentId == null);
    const agentPermissions = toolPerms
      .filter((p): p is typeof p & { agentId: string } => p.agentId != null)
      .map((p) => ({
        agentId: p.agentId,
        permission: p.permission as ToolPermission,
      }));

    let accountLogin: string | null = null;
    let connected = tool.status === "active";
    try {
      if (isEncryptedEnvelope(tool.authConfig)) {
        const auth = decryptJson(tool.authConfig);
        if (auth.placeholder === true) {
          connected = false;
        } else if (typeof auth.login === "string") {
          accountLogin = auth.login;
        } else if (typeof auth.account_login === "string") {
          accountLogin = auth.account_login;
        }
      }
    } catch {
      connected = false;
    }

    return {
      id: tool.id,
      orgId: tool.orgId,
      toolName: tool.toolName,
      status: tool.status,
      createdAt:
        tool.createdAt instanceof Date
          ? tool.createdAt.toISOString()
          : tool.createdAt
            ? String(tool.createdAt)
            : null,
      permission: (orgDefault?.permission as ToolPermission) ?? "restricted",
      agentPermissions,
      connected,
      accountLogin,
    };
  });
}

/**
 * Ensure a connected_tools row exists for permission toggles even before OAuth.
 * Disconnected stubs use encrypted placeholder auth — no plaintext secrets.
 */
export async function ensureOrgTool(
  orgId: string,
  toolName: SupportedToolName
): Promise<ConnectedToolRow> {
  const [existing] = await db
    .select()
    .from(connectedTools)
    .where(
      and(
        eq(connectedTools.orgId, orgId),
        eq(connectedTools.toolName, toolName)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(connectedTools)
    .values({
      orgId,
      toolName,
      authConfig: emptyEncryptedAuth(),
      status: "disconnected",
    })
    .returning();

  await db.insert(agentToolPermissions).values({
    orgId,
    agentId: null,
    toolId: created.id,
    permission: "restricted",
  });

  return created;
}

export async function setToolPermission(opts: {
  orgId: string;
  toolId: string;
  permission: ToolPermission;
  agentId?: string | null;
}): Promise<ToolPermissionRow> {
  const [tool] = await db
    .select()
    .from(connectedTools)
    .where(
      and(
        eq(connectedTools.id, opts.toolId),
        eq(connectedTools.orgId, opts.orgId)
      )
    )
    .limit(1);

  if (!tool) {
    throw new AuthError("Tool not found", 404);
  }

  const agentId = opts.agentId ?? null;
  if (agentId) {
    const agent = await getOrgAgent(opts.orgId, agentId);
    if (!agent) {
      throw new AuthError("Agent not found", 404);
    }
  }

  const agentClause =
    agentId === null
      ? isNull(agentToolPermissions.agentId)
      : eq(agentToolPermissions.agentId, agentId);

  const [existing] = await db
    .select()
    .from(agentToolPermissions)
    .where(
      and(
        eq(agentToolPermissions.orgId, opts.orgId),
        eq(agentToolPermissions.toolId, opts.toolId),
        agentClause
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(agentToolPermissions)
      .set({ permission: opts.permission })
      .where(eq(agentToolPermissions.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(agentToolPermissions)
    .values({
      orgId: opts.orgId,
      agentId,
      toolId: opts.toolId,
      permission: opts.permission,
    })
    .returning();
  return created;
}

export async function getToolPermissionForName(
  orgId: string,
  toolName: string,
  agentId?: string | null
): Promise<{
  tool: ConnectedToolRow | null;
  permission: ToolPermission | null;
  scope: "agent" | "org" | null;
}> {
  const [tool] = await db
    .select()
    .from(connectedTools)
    .where(
      and(eq(connectedTools.orgId, orgId), eq(connectedTools.toolName, toolName))
    )
    .limit(1);

  if (!tool) {
    return { tool: null, permission: null, scope: null };
  }

  if (agentId) {
    const [agentPerm] = await db
      .select()
      .from(agentToolPermissions)
      .where(
        and(
          eq(agentToolPermissions.orgId, orgId),
          eq(agentToolPermissions.toolId, tool.id),
          eq(agentToolPermissions.agentId, agentId)
        )
      )
      .limit(1);
    if (agentPerm) {
      return {
        tool,
        permission: agentPerm.permission as ToolPermission,
        scope: "agent",
      };
    }
  }

  const [orgPerm] = await db
    .select()
    .from(agentToolPermissions)
    .where(
      and(
        eq(agentToolPermissions.orgId, orgId),
        eq(agentToolPermissions.toolId, tool.id),
        isNull(agentToolPermissions.agentId)
      )
    )
    .limit(1);

  return {
    tool,
    permission: (orgPerm?.permission as ToolPermission) ?? "restricted",
    scope: orgPerm ? "org" : null,
  };
}

function syntheticToolCheckpointMatch(
  toolName: string
): PolicyMatch {
  return {
    policy: {
      id: "00000000-0000-4000-8000-000000000014",
      orgId: "00000000-0000-4000-8000-000000000000",
      name: `Tool Mesh · ${toolName}`,
      triggerType: "tool_call",
      triggerConfig: { tool_name: toolName },
      requiredRole: "owner",
      active: true,
      createdAt: new Date(),
    },
    reason: `Tool "${toolName}" requires checkpoint (Tool Mesh permission)`,
    detail: { tool_name: toolName, source: "agent_tool_permissions" },
  };
}

export type ToolAuthorizationResult =
  | { decision: "allow" }
  | {
      decision: "block";
      reason: string;
    }
  | {
      decision: "checkpoint";
      checkpoint: SessionEventRow;
    };

/**
 * Permission gate before any tool invocation (mock or real).
 * - restricted → block
 * - requires_checkpoint → Step 10 evaluatePolicies(tool_call) + raise/pause
 * - allowed → proceed
 * - no tool row yet → allow (legacy mock tools without mesh config)
 */
export async function authorizeToolInvocation(opts: {
  orgId: string | null;
  sessionId: string;
  toolName: string;
  actorId?: string | null;
  agentId?: string | null;
}): Promise<ToolAuthorizationResult> {
  if (!opts.orgId) {
    return { decision: "allow" };
  }

  const agentId =
    opts.agentId !== undefined
      ? opts.agentId
      : await getSessionAgentId(opts.sessionId);

  const { permission } = await getToolPermissionForName(
    opts.orgId,
    opts.toolName,
    agentId
  );

  // No Tool Mesh record yet — do not block unconfigured mock tools.
  if (permission == null) {
    return { decision: "allow" };
  }

  if (permission === "restricted") {
    return {
      decision: "block",
      reason: `Tool "${opts.toolName}" is restricted by Tool Mesh`,
    };
  }

  if (permission === "requires_checkpoint") {
    const matches = await evaluatePolicies({
      orgId: opts.orgId,
      sessionId: opts.sessionId,
      trigger: { type: "tool_call", toolName: opts.toolName },
    });
    const match = matches[0] ?? syntheticToolCheckpointMatch(opts.toolName);
    const checkpoint = await raiseCheckpoint({
      sessionId: opts.sessionId,
      actorId: opts.actorId ?? null,
      match,
    });
    await setSessionCheckpointPaused(opts.sessionId, true);
    return { decision: "checkpoint", checkpoint };
  }

  return { decision: "allow" };
}

export async function getSessionOrgId(sessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: sessions.orgId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return row?.orgId ?? null;
}

export async function storeGithubConnection(opts: {
  orgId: string;
  accessToken: string;
  tokenType?: string;
  scope?: string;
  login: string;
  githubUserId: number | string;
}): Promise<ConnectedToolRow> {
  const authConfig = encryptJson({
    access_token: opts.accessToken,
    token_type: opts.tokenType ?? "bearer",
    scope: opts.scope ?? "",
    login: opts.login,
    github_user_id: opts.githubUserId,
    connected_at: new Date().toISOString(),
  });

  const existing = await ensureOrgTool(opts.orgId, "github");

  const [updated] = await db
    .update(connectedTools)
    .set({
      authConfig,
      status: "active",
    })
    .where(eq(connectedTools.id, existing.id))
    .returning();

  // Keep permission row; default stays whatever was set (or restricted).
  return updated;
}

export async function disconnectTool(opts: {
  orgId: string;
  toolId: string;
}): Promise<void> {
  const [tool] = await db
    .select()
    .from(connectedTools)
    .where(
      and(
        eq(connectedTools.id, opts.toolId),
        eq(connectedTools.orgId, opts.orgId)
      )
    )
    .limit(1);

  if (!tool) {
    throw new AuthError("Tool not found", 404);
  }

  await db
    .update(connectedTools)
    .set({
      authConfig: emptyEncryptedAuth(),
      status: "disconnected",
    })
    .where(eq(connectedTools.id, tool.id));
}

export async function getGithubAccessToken(
  orgId: string
): Promise<string | null> {
  const { tool } = await getToolPermissionForName(orgId, "github");
  if (!tool || tool.status !== "active") return null;
  try {
    const auth = decryptJson(tool.authConfig);
    return typeof auth.access_token === "string" ? auth.access_token : null;
  } catch {
    return null;
  }
}
