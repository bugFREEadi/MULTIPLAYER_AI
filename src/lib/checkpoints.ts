import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { checkpointPolicies, sessions } from "@/db/schema";
import { AuthError } from "@/lib/auth-error";
import { appendSessionEvent, listOwnSessionEvents, type SessionEventRow } from "@/lib/events";
import { isSessionRole } from "@/lib/rbac";

export type CheckpointPolicyRow = typeof checkpointPolicies.$inferSelect;

/** Trigger types stored on policies. Only keyword + manual are evaluated in Step 10. */
export type CheckpointTriggerType =
  | "keyword"
  | "manual"
  | "tool_call"
  | "budget_threshold";

/**
 * Evaluation context for the single org policy evaluator.
 * Extend this union as new trigger kinds come online (tool_call in Step 14,
 * budget_threshold in Step 13) — do not replace the evaluator.
 */
export type PolicyEvaluationTrigger =
  | { type: "keyword"; text: string }
  | { type: "manual"; policyId?: string }
  | { type: "tool_call"; toolName: string }
  | { type: "budget_threshold"; spendUsd: number };

export type PolicyEvaluationContext = {
  orgId: string;
  sessionId: string;
  trigger: PolicyEvaluationTrigger;
};

export type PolicyMatch = {
  policy: CheckpointPolicyRow;
  reason: string;
  detail: Record<string, unknown>;
};

export const SESSION_STATUS_PAUSED_CHECKPOINT = "paused_checkpoint";
export const SESSION_STATUS_ACTIVE = "active";

function asConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function keywordList(config: Record<string, unknown>): string[] {
  if (typeof config.keyword === "string" && config.keyword.trim()) {
    return [config.keyword.trim()];
  }
  if (Array.isArray(config.keywords)) {
    return config.keywords
      .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
      .map((k) => k.trim());
  }
  return [];
}

function matchesKeywordPolicy(
  policy: CheckpointPolicyRow,
  text: string
): PolicyMatch | null {
  const config = asConfig(policy.triggerConfig);
  const keywords = keywordList(config);
  const haystack = text.toLowerCase();
  for (const keyword of keywords) {
    if (haystack.includes(keyword.toLowerCase())) {
      return {
        policy,
        reason: `Matched keyword "${keyword}"`,
        detail: { keyword },
      };
    }
  }
  return null;
}

/**
 * ONE org policy evaluator — seed of the Phase 3 governance layer.
 * Returns all matching active policies for the given trigger context.
 * Unknown / not-yet-wired trigger types (tool_call, budget_threshold) yield
 * no matches until those steps register handlers here.
 */
export async function evaluatePolicies(
  ctx: PolicyEvaluationContext
): Promise<PolicyMatch[]> {
  // Always evaluate the full set of active org policies (Step 10 baseline).
  // Pattern-attached policy IDs on the session are scaffold metadata only —
  // they must not exclude org-wide governance (additive, not exclusive).
  void ctx.sessionId;

  const policies = await db
    .select()
    .from(checkpointPolicies)
    .where(
      and(
        eq(checkpointPolicies.orgId, ctx.orgId),
        eq(checkpointPolicies.active, true)
      )
    )
    .orderBy(asc(checkpointPolicies.name));

  const matches: PolicyMatch[] = [];

  for (const policy of policies) {
    if (ctx.trigger.type === "keyword" && policy.triggerType === "keyword") {
      const match = matchesKeywordPolicy(policy, ctx.trigger.text);
      if (match) matches.push(match);
      continue;
    }

    if (ctx.trigger.type === "manual" && policy.triggerType === "manual") {
      if (ctx.trigger.policyId && ctx.trigger.policyId !== policy.id) {
        continue;
      }
      matches.push({
        policy,
        reason: "Manual checkpoint",
        detail: {},
      });
      continue;
    }

    if (ctx.trigger.type === "tool_call" && policy.triggerType === "tool_call") {
      const config = asConfig(policy.triggerConfig);
      const configured =
        typeof config.tool_name === "string"
          ? config.tool_name
          : typeof config.toolName === "string"
            ? config.toolName
            : null;
      if (
        configured &&
        configured.toLowerCase() === ctx.trigger.toolName.toLowerCase()
      ) {
        matches.push({
          policy,
          reason: `Tool call "${ctx.trigger.toolName}" matched policy`,
          detail: { tool_name: ctx.trigger.toolName },
        });
      }
      continue;
    }

    // budget_threshold: reserved — spend soft-lock lives in Step 13 budget guards.
  }

  return matches;
}

export async function setSessionCheckpointPaused(
  sessionId: string,
  paused: boolean
) {
  await db
    .update(sessions)
    .set({
      status: paused ? SESSION_STATUS_PAUSED_CHECKPOINT : SESSION_STATUS_ACTIVE,
    })
    .where(eq(sessions.id, sessionId));
}

export function assertSessionNotPausedForWrites(session: {
  status: string;
}) {
  if (session.status === SESSION_STATUS_PAUSED_CHECKPOINT) {
    throw new AuthError(
      "Session paused pending checkpoint resolution",
      409
    );
  }
}

export async function raiseCheckpoint(opts: {
  sessionId: string;
  actorId: string | null;
  match: PolicyMatch;
  sourceEventId?: string | null;
}): Promise<SessionEventRow> {
  const { match } = opts;
  return appendSessionEvent({
    sessionId: opts.sessionId,
    eventType: "checkpoint_raised",
    actorId: opts.actorId,
    actorType: opts.actorId ? "human" : "agent",
    payload: {
      policy_id: match.policy.id,
      policy_name: match.policy.name,
      trigger_type: match.policy.triggerType,
      required_role: match.policy.requiredRole,
      reason: match.reason,
      detail: match.detail,
      source_event_id: opts.sourceEventId ?? null,
      status: "pending",
    },
  });
}

/**
 * After a user_message is appended: evaluate keyword policies; if any match,
 * raise checkpoint + pause session (caller must skip the agent turn).
 */
export async function maybeRaiseCheckpointForUserMessage(opts: {
  sessionId: string;
  orgId: string | null;
  actorId: string;
  userMessageEvent: SessionEventRow;
  content: string;
}): Promise<{ paused: boolean; checkpoint: SessionEventRow | null }> {
  if (!opts.orgId) {
    return { paused: false, checkpoint: null };
  }

  const matches = await evaluatePolicies({
    orgId: opts.orgId,
    sessionId: opts.sessionId,
    trigger: { type: "keyword", text: opts.content },
  });

  if (matches.length === 0) {
    return { paused: false, checkpoint: null };
  }

  const checkpoint = await raiseCheckpoint({
    sessionId: opts.sessionId,
    actorId: opts.actorId,
    match: matches[0],
    sourceEventId: opts.userMessageEvent.id,
  });
  await setSessionCheckpointPaused(opts.sessionId, true);
  return { paused: true, checkpoint };
}

export async function raiseManualCheckpoint(opts: {
  sessionId: string;
  orgId: string;
  actorId: string;
  policyId?: string;
}): Promise<SessionEventRow> {
  const matches = await evaluatePolicies({
    orgId: opts.orgId,
    sessionId: opts.sessionId,
    trigger: { type: "manual", policyId: opts.policyId },
  });

  if (matches.length === 0) {
    throw new AuthError(
      opts.policyId
        ? "No active manual policy found for that id"
        : "No active manual checkpoint policies for this org",
      404
    );
  }

  const checkpoint = await raiseCheckpoint({
    sessionId: opts.sessionId,
    actorId: opts.actorId,
    match: matches[0],
  });
  await setSessionCheckpointPaused(opts.sessionId, true);
  return checkpoint;
}

function unresolvedCheckpointIds(events: SessionEventRow[]): Map<string, SessionEventRow> {
  const raised = new Map<string, SessionEventRow>();
  const resolved = new Set<string>();

  for (const event of events) {
    if (event.eventType === "checkpoint_raised") {
      raised.set(event.id, event);
    }
    if (event.eventType === "checkpoint_resolved") {
      const payload = event.payload as Record<string, unknown>;
      if (typeof payload.checkpoint_event_id === "string") {
        resolved.add(payload.checkpoint_event_id);
      }
    }
  }

  for (const id of resolved) {
    raised.delete(id);
  }
  return raised;
}

export async function listPendingCheckpoints(
  sessionId: string
): Promise<SessionEventRow[]> {
  const events = await listOwnSessionEvents(sessionId, 0);
  return [...unresolvedCheckpointIds(events).values()].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
}

export async function findPendingCheckpoint(
  sessionId: string,
  checkpointEventId: string
): Promise<SessionEventRow | null> {
  // Only this session's own events — inherited parent checkpoints do not
  // control branch pause/resolve state.
  const events = await listOwnSessionEvents(sessionId, 0);
  const pending = unresolvedCheckpointIds(events);
  return pending.get(checkpointEventId) ?? null;
}


export async function resolveCheckpoint(opts: {
  sessionId: string;
  checkpointEventId: string;
  actorId: string;
  actorRole: string;
  decision: "approve" | "reject";
}): Promise<{
  resolved: SessionEventRow;
  shouldRunAgent: boolean;
  approvedToolEvent: SessionEventRow | null;
}> {
  const pending = await findPendingCheckpoint(
    opts.sessionId,
    opts.checkpointEventId
  );
  if (!pending) {
    throw new AuthError("Checkpoint not found or already resolved", 404);
  }

  const payload = pending.payload as Record<string, unknown>;
  const requiredRole =
    typeof payload.required_role === "string" ? payload.required_role : null;
  if (!requiredRole || !isSessionRole(requiredRole)) {
    throw new AuthError("Checkpoint is missing a valid required_role", 500);
  }
  if (opts.actorRole !== requiredRole) {
    throw new AuthError(
      `Forbidden: role '${opts.actorRole}' cannot resolve this checkpoint (requires '${requiredRole}')`,
      403
    );
  }

  const resolved = await appendSessionEvent({
    sessionId: opts.sessionId,
    eventType: "checkpoint_resolved",
    actorId: opts.actorId,
    actorType: "human",
    payload: {
      checkpoint_event_id: pending.id,
      policy_id: payload.policy_id ?? null,
      decision: opts.decision,
      required_role: requiredRole,
    },
  });

  // Clear pause if no other unresolved checkpoints remain on THIS session.
  const events = await listOwnSessionEvents(opts.sessionId, 0);
  const stillPending = unresolvedCheckpointIds(events);
  if (stillPending.size === 0) {
    await setSessionCheckpointPaused(opts.sessionId, false);
  }

  // Keyword checkpoints deferred the agent turn — resume it on approve.
  // Tool Mesh checkpoints: on approve, emit the gated tool_call event once
  // (do not re-enter the agent loop — that would raise the same checkpoint).
  const triggerType =
    typeof payload.trigger_type === "string" ? payload.trigger_type : null;
  const shouldRunAgent =
    opts.decision === "approve" && triggerType === "keyword";

  let approvedToolEvent: SessionEventRow | null = null;
  if (opts.decision === "approve" && triggerType === "tool_call") {
    const detail =
      payload.detail &&
      typeof payload.detail === "object" &&
      !Array.isArray(payload.detail)
        ? (payload.detail as Record<string, unknown>)
        : {};
    const toolName =
      typeof detail.tool_name === "string"
        ? detail.tool_name
        : "tool";
    approvedToolEvent = await appendSessionEvent({
      sessionId: opts.sessionId,
      eventType: "agent_tool_call",
      actorId: null,
      actorType: "agent",
      payload: {
        tool_call_id: `approved_tool_${Date.now()}`,
        tool_name: toolName,
        arguments: { approved_via_checkpoint: true },
        checkpoint_event_id: pending.id,
      },
    });
  }

  return {
    resolved,
    shouldRunAgent,
    approvedToolEvent,
  };
}

export type PolicyCreateInput = {
  orgId: string;
  name: string;
  triggerType: "keyword" | "manual";
  triggerConfig: Record<string, unknown>;
  requiredRole: string;
  active?: boolean;
};

export async function createCheckpointPolicy(input: PolicyCreateInput) {
  if (!isSessionRole(input.requiredRole)) {
    throw new AuthError("required_role must be a valid session role", 400);
  }
  if (input.triggerType === "keyword") {
    const keywords = keywordList(input.triggerConfig);
    if (keywords.length === 0) {
      throw new AuthError(
        'keyword policies require trigger_config.keyword or trigger_config.keywords',
        400
      );
    }
  }

  const [row] = await db
    .insert(checkpointPolicies)
    .values({
      orgId: input.orgId,
      name: input.name.trim(),
      triggerType: input.triggerType,
      triggerConfig: input.triggerConfig,
      requiredRole: input.requiredRole,
      active: input.active ?? true,
    })
    .returning();
  return row;
}

export async function listCheckpointPolicies(orgId: string) {
  return db
    .select()
    .from(checkpointPolicies)
    .where(eq(checkpointPolicies.orgId, orgId))
    .orderBy(asc(checkpointPolicies.name));
}

export async function setCheckpointPolicyActive(
  orgId: string,
  policyId: string,
  active: boolean
) {
  const [row] = await db
    .update(checkpointPolicies)
    .set({ active })
    .where(
      and(
        eq(checkpointPolicies.id, policyId),
        eq(checkpointPolicies.orgId, orgId)
      )
    )
    .returning();
  if (!row) {
    throw new AuthError("Policy not found", 404);
  }
  return row;
}
