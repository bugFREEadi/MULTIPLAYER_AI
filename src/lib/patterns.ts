import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  checkpointPolicies,
  sessionMembers,
  sessions,
  workflowPatterns,
} from "@/db/schema";
import { getOrgAgent } from "@/lib/agents";
import { AuthError } from "@/lib/auth-error";
import { assertOrgBudgetAllowsNewWork } from "@/lib/budget";
import { appendSessionEvent } from "@/lib/events";
import { isSessionRole } from "@/lib/rbac";

export type WorkflowPatternRow = typeof workflowPatterns.$inferSelect;

export type PatternStep = {
  agent_id?: string | null;
  role?: string | null;
  checkpoint_policy_id?: string | null;
  label?: string | null;
};

function normalizeSteps(raw: unknown): PatternStep[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AuthError("steps must be a non-empty array", 400);
  }
  const steps: PatternStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AuthError(`steps[${i}] must be an object`, 400);
    }
    const row = item as Record<string, unknown>;
    const agentId =
      row.agent_id === null || row.agent_id === undefined
        ? null
        : typeof row.agent_id === "string"
          ? row.agent_id.trim() || null
          : null;
    if (row.agent_id != null && typeof row.agent_id !== "string") {
      throw new AuthError(`steps[${i}].agent_id must be a string`, 400);
    }
    const role =
      row.role === null || row.role === undefined
        ? null
        : typeof row.role === "string"
          ? row.role.trim() || null
          : null;
    if (row.role != null && typeof row.role !== "string") {
      throw new AuthError(`steps[${i}].role must be a string`, 400);
    }
    if (role && !isSessionRole(role)) {
      throw new AuthError(
        `steps[${i}].role must be owner|pilot|reviewer|observer`,
        400
      );
    }
    const policyId =
      row.checkpoint_policy_id === null ||
      row.checkpoint_policy_id === undefined
        ? null
        : typeof row.checkpoint_policy_id === "string"
          ? row.checkpoint_policy_id.trim() || null
          : null;
    if (
      row.checkpoint_policy_id != null &&
      typeof row.checkpoint_policy_id !== "string"
    ) {
      throw new AuthError(
        `steps[${i}].checkpoint_policy_id must be a string`,
        400
      );
    }
    const label =
      typeof row.label === "string" ? row.label.trim() || null : null;
    if (!agentId && !role && !policyId) {
      throw new AuthError(
        `steps[${i}] needs agent_id, role, and/or checkpoint_policy_id`,
        400
      );
    }
    steps.push({
      agent_id: agentId,
      role,
      checkpoint_policy_id: policyId,
      label,
    });
  }
  return steps;
}

async function assertStepRefsBelongToOrg(
  orgId: string,
  steps: PatternStep[],
  opts?: { allowInactiveAgents?: boolean }
) {
  for (const step of steps) {
    if (step.agent_id) {
      const agent = await getOrgAgent(orgId, step.agent_id);
      if (!agent) {
        throw new AuthError(
          `agent_id ${step.agent_id} must reference an org agent`,
          400
        );
      }
      if (!opts?.allowInactiveAgents && agent.status !== "active") {
        throw new AuthError(
          `agent_id ${step.agent_id} must reference an active org agent`,
          400
        );
      }
    }
    if (step.checkpoint_policy_id) {
      const [policy] = await db
        .select()
        .from(checkpointPolicies)
        .where(
          and(
            eq(checkpointPolicies.id, step.checkpoint_policy_id),
            eq(checkpointPolicies.orgId, orgId)
          )
        )
        .limit(1);
      if (!policy) {
        throw new AuthError(
          `checkpoint_policy_id ${step.checkpoint_policy_id} not found in org`,
          400
        );
      }
    }
  }
}

export async function listOrgPatterns(
  orgId: string
): Promise<WorkflowPatternRow[]> {
  return db
    .select()
    .from(workflowPatterns)
    .where(eq(workflowPatterns.orgId, orgId))
    .orderBy(desc(workflowPatterns.createdAt));
}

export async function getOrgPattern(
  orgId: string,
  patternId: string
): Promise<WorkflowPatternRow | null> {
  const [row] = await db
    .select()
    .from(workflowPatterns)
    .where(
      and(
        eq(workflowPatterns.id, patternId),
        eq(workflowPatterns.orgId, orgId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function createPattern(input: {
  orgId: string;
  name: string;
  steps: unknown;
  isPublic?: boolean;
  createdFromSessionId?: string | null;
}): Promise<WorkflowPatternRow> {
  if (!input.name.trim()) {
    throw new AuthError("name is required", 400);
  }
  const steps = normalizeSteps(input.steps);
  await assertStepRefsBelongToOrg(input.orgId, steps, {
    allowInactiveAgents: Boolean(input.createdFromSessionId),
  });

  const [row] = await db
    .insert(workflowPatterns)
    .values({
      orgId: input.orgId,
      name: input.name.trim(),
      steps,
      isPublic: input.isPublic === true,
      createdFromSessionId: input.createdFromSessionId ?? null,
    })
    .returning();
  return row;
}

export async function updatePattern(
  orgId: string,
  patternId: string,
  patch: {
    name?: string;
    steps?: unknown;
    isPublic?: boolean;
  }
): Promise<WorkflowPatternRow> {
  const existing = await getOrgPattern(orgId, patternId);
  if (!existing) {
    throw new AuthError("Pattern not found", 404);
  }

  const updates: Partial<typeof workflowPatterns.$inferInsert> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new AuthError("name is required", 400);
    updates.name = patch.name.trim();
  }
  if (patch.steps !== undefined) {
    const steps = normalizeSteps(patch.steps);
    await assertStepRefsBelongToOrg(orgId, steps);
    updates.steps = steps;
  }
  if (patch.isPublic !== undefined) {
    updates.isPublic = patch.isPublic;
  }

  const [row] = await db
    .update(workflowPatterns)
    .set(updates)
    .where(
      and(
        eq(workflowPatterns.id, patternId),
        eq(workflowPatterns.orgId, orgId)
      )
    )
    .returning();
  return row;
}

export async function deletePattern(orgId: string, patternId: string) {
  const existing = await getOrgPattern(orgId, patternId);
  if (!existing) {
    throw new AuthError("Pattern not found", 404);
  }
  await db
    .delete(workflowPatterns)
    .where(
      and(
        eq(workflowPatterns.id, patternId),
        eq(workflowPatterns.orgId, orgId)
      )
    );
}

/**
 * Spin up a new session pre-wired from a pattern:
 * - agent_id from first step that has one
 * - attached_checkpoint_policy_ids from all steps that declare them
 * - pattern_scaffold event documenting the ordered steps
 */
export async function spinUpSessionFromPattern(input: {
  orgId: string;
  userId: string;
  patternId: string;
  title?: string | null;
}) {
  await assertOrgBudgetAllowsNewWork(input.orgId);

  const pattern = await getOrgPattern(input.orgId, input.patternId);
  if (!pattern) {
    throw new AuthError("Pattern not found", 404);
  }

  const steps = pattern.steps as PatternStep[];
  const agentId =
    steps.find((s) => s.agent_id)?.agent_id ?? null;
  const attachedPolicyIds = [
    ...new Set(
      steps
        .map((s) => s.checkpoint_policy_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  if (agentId) {
    const agent = await getOrgAgent(input.orgId, agentId);
    if (!agent || agent.status !== "active") {
      throw new AuthError(
        "Pattern's first agent is missing or inactive",
        400
      );
    }
  }

  const created = await db.transaction(async (tx) => {
    const [session] = await tx
      .insert(sessions)
      .values({
        orgId: input.orgId,
        title: input.title?.trim() || `From pattern: ${pattern.name}`,
        status: "active",
        visibility: "internal_only",
        agentId,
        workflowPatternId: pattern.id,
        attachedCheckpointPolicyIds:
          attachedPolicyIds.length > 0 ? attachedPolicyIds : [],
        createdBy: input.userId,
      })
      .returning();

    await tx.insert(sessionMembers).values({
      sessionId: session.id,
      userId: input.userId,
      role: "owner",
    });

    return session;
  });

  await appendSessionEvent({
    sessionId: created.id,
    eventType: "pattern_scaffold",
    actorId: input.userId,
    actorType: "human",
    payload: {
      pattern_id: pattern.id,
      pattern_name: pattern.name,
      steps,
      agent_id: agentId,
      attached_checkpoint_policy_ids: attachedPolicyIds,
    },
  });

  return { session: created, pattern };
}

export async function getSessionAttachedPolicyIds(
  sessionId: string
): Promise<string[] | null> {
  const [row] = await db
    .select({
      attached: sessions.attachedCheckpointPolicyIds,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return null;
  const attached = row.attached;
  if (attached === null || attached === undefined) return null;
  if (!Array.isArray(attached)) return null;
  return attached.filter((id): id is string => typeof id === "string");
}
