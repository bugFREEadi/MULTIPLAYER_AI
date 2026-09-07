import { and, asc, desc, eq, gte, inArray, lte, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  agentRuns,
  agents,
  sessionEvents,
  sessions,
  users,
} from "@/db/schema";
import { AuthError } from "@/lib/auth-error";

export type AgentRow = typeof agents.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;

export const AGENT_RUN_OUTCOMES = ["success", "failure", "escalated"] as const;
export type AgentRunOutcome = (typeof AGENT_RUN_OUTCOMES)[number];

export const MODEL_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "custom",
] as const;

export function isModelProvider(
  value: string
): value is (typeof MODEL_PROVIDERS)[number] {
  return (MODEL_PROVIDERS as readonly string[]).includes(value);
}

export async function listOrgAgents(orgId: string): Promise<AgentRow[]> {
  return db
    .select()
    .from(agents)
    .where(eq(agents.orgId, orgId))
    .orderBy(asc(agents.name));
}

export async function getOrgAgent(
  orgId: string,
  agentId: string
): Promise<AgentRow | null> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.id, agentId)))
    .limit(1);
  return row ?? null;
}

export async function createAgent(input: {
  orgId: string;
  name: string;
  version: string;
  modelProvider: string;
  modelId: string;
  systemPrompt?: string | null;
  ownerId: string;
}): Promise<AgentRow> {
  if (!input.name.trim()) {
    throw new AuthError("name is required", 400);
  }
  if (!input.version.trim()) {
    throw new AuthError("version is required", 400);
  }
  if (!isModelProvider(input.modelProvider)) {
    throw new AuthError(
      'model_provider must be anthropic | openai | google | custom',
      400
    );
  }
  if (!input.modelId.trim()) {
    throw new AuthError("model_id is required", 400);
  }

  const [row] = await db
    .insert(agents)
    .values({
      orgId: input.orgId,
      name: input.name.trim(),
      version: input.version.trim(),
      modelProvider: input.modelProvider,
      modelId: input.modelId.trim(),
      systemPrompt: input.systemPrompt?.trim() || null,
      ownerId: input.ownerId,
      status: "active",
    })
    .returning();
  return row;
}

export async function updateAgent(opts: {
  orgId: string;
  agentId: string;
  patch: {
    name?: string;
    version?: string;
    modelProvider?: string;
    modelId?: string;
    systemPrompt?: string | null;
    status?: "active" | "inactive";
  };
}): Promise<AgentRow> {
  const existing = await getOrgAgent(opts.orgId, opts.agentId);
  if (!existing) {
    throw new AuthError("Agent not found", 404);
  }

  const patch = opts.patch;
  if (patch.modelProvider != null && !isModelProvider(patch.modelProvider)) {
    throw new AuthError(
      'model_provider must be anthropic | openai | google | custom',
      400
    );
  }
  if (patch.status != null && patch.status !== "active" && patch.status !== "inactive") {
    throw new AuthError('status must be "active" or "inactive"', 400);
  }

  const [row] = await db
    .update(agents)
    .set({
      name: patch.name?.trim() ?? existing.name,
      version: patch.version?.trim() ?? existing.version,
      modelProvider: patch.modelProvider ?? existing.modelProvider,
      modelId: patch.modelId?.trim() ?? existing.modelId,
      systemPrompt:
        patch.systemPrompt === undefined
          ? existing.systemPrompt
          : patch.systemPrompt?.trim() || null,
      status: patch.status ?? existing.status,
    })
    .where(eq(agents.id, opts.agentId))
    .returning();
  return row;
}

export async function deactivateAgent(
  orgId: string,
  agentId: string
): Promise<AgentRow> {
  return updateAgent({
    orgId,
    agentId,
    patch: { status: "inactive" },
  });
}

/**
 * Start an agent_run for the session's bound agent.
 * Returns null when the session has no agent_id (legacy sessions).
 */
export async function startAgentRun(
  sessionId: string
): Promise<AgentRunRow | null> {
  const [session] = await db
    .select({
      id: sessions.id,
      agentId: sessions.agentId,
      orgId: sessions.orgId,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session?.agentId) {
    return null;
  }

  const agent = session.orgId
    ? await getOrgAgent(session.orgId, session.agentId)
    : null;
  if (!agent || agent.status !== "active") {
    throw new AuthError(
      "Session agent is missing or inactive — pick an active Agent Fleet agent",
      400
    );
  }

  const [run] = await db
    .insert(agentRuns)
    .values({
      agentId: session.agentId,
      sessionId,
      startedAt: new Date(),
    })
    .returning();
  return run;
}

export async function completeAgentRun(
  runId: string,
  outcome: AgentRunOutcome
): Promise<AgentRunRow> {
  const [row] = await db
    .update(agentRuns)
    .set({
      completedAt: new Date(),
      outcome,
    })
    .where(eq(agentRuns.id, runId))
    .returning();
  if (!row) {
    throw new AuthError("Agent run not found", 404);
  }
  return row;
}

export type AgentMetrics = {
  agentId: string;
  runCount: number;
  successCount: number;
  failureCount: number;
  escalatedCount: number;
  failRate: number;
  avgDurationMs: number | null;
  avgCostUsd: number;
  lastUsedAt: string | null;
};

async function costForRun(run: AgentRunRow): Promise<number> {
  if (!run.startedAt) return 0;
  const end = run.completedAt ?? new Date();
  const [row] = await db
    .select({ total: sum(sessionEvents.costUsd) })
    .from(sessionEvents)
    .where(
      and(
        eq(sessionEvents.sessionId, run.sessionId),
        gte(sessionEvents.createdAt, run.startedAt),
        lte(sessionEvents.createdAt, end)
      )
    );
  const n = row?.total != null ? Number(row.total) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function getAgentMetrics(agentId: string): Promise<AgentMetrics> {
  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.agentId, agentId))
    .orderBy(desc(agentRuns.startedAt));

  let successCount = 0;
  let failureCount = 0;
  let escalatedCount = 0;
  let durationSum = 0;
  let durationN = 0;
  let costSum = 0;

  for (const run of runs) {
    if (run.outcome === "success") successCount += 1;
    else if (run.outcome === "failure") failureCount += 1;
    else if (run.outcome === "escalated") escalatedCount += 1;

    if (run.startedAt && run.completedAt) {
      durationSum +=
        run.completedAt.getTime() - run.startedAt.getTime();
      durationN += 1;
    }
    costSum += await costForRun(run);
  }

  const runCount = runs.length;
  const last = runs[0]?.startedAt ?? null;

  return {
    agentId,
    runCount,
    successCount,
    failureCount,
    escalatedCount,
    failRate: runCount === 0 ? 0 : failureCount / runCount,
    avgDurationMs: durationN === 0 ? null : durationSum / durationN,
    avgCostUsd: runCount === 0 ? 0 : costSum / runCount,
    lastUsedAt: last ? last.toISOString() : null,
  };
}

export async function listAgentsWithMetrics(orgId: string) {
  const rows = await listOrgAgents(orgId);
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter(Boolean))] as string[];
  const owners =
    ownerIds.length === 0
      ? []
      : await db.select().from(users).where(inArray(users.id, ownerIds));
  const ownerById = new Map(owners.map((o) => [o.id, o]));

  const withMetrics = await Promise.all(
    rows.map(async (agent) => {
      const metrics = await getAgentMetrics(agent.id);
      const owner = agent.ownerId ? ownerById.get(agent.ownerId) : null;
      return {
        agent,
        metrics,
        owner: owner
          ? {
              id: owner.id,
              name: owner.name,
              email: owner.email,
            }
          : null,
      };
    })
  );

  return withMetrics;
}

export async function bindSessionAgent(opts: {
  sessionId: string;
  orgId: string;
  agentId: string | null;
}) {
  if (opts.agentId) {
    const agent = await getOrgAgent(opts.orgId, opts.agentId);
    if (!agent || agent.status !== "active") {
      throw new AuthError("Agent not found or inactive", 400);
    }
  }
  const [row] = await db
    .update(sessions)
    .set({ agentId: opts.agentId })
    .where(and(eq(sessions.id, opts.sessionId), eq(sessions.orgId, opts.orgId)))
    .returning();
  if (!row) {
    throw new AuthError("Session not found", 404);
  }
  return row;
}

/** Resolve session's agent id for tool permission checks. */
export async function getSessionAgentId(
  sessionId: string
): Promise<string | null> {
  const [row] = await db
    .select({ agentId: sessions.agentId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return row?.agentId ?? null;
}
