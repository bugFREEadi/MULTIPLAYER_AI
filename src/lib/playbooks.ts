import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, sessions } from "@/db/schema";
import { AuthError } from "@/lib/auth-error";
import { appendSessionEvent, listSessionEvents } from "@/lib/events";
import { isMockAiEnabled } from "@/lib/mock-ai";
import {
  createPattern,
  type PatternStep,
  type WorkflowPatternRow,
} from "@/lib/patterns";

export const SESSION_STATUS_COMPLETED = "completed";

export async function markSessionCompleted(opts: {
  orgId: string;
  sessionId: string;
}) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.id, opts.sessionId), eq(sessions.orgId, opts.orgId))
    )
    .limit(1);
  if (!session) {
    throw new AuthError("Session not found", 404);
  }
  if (session.status === "paused_checkpoint") {
    throw new AuthError(
      "Resolve the pending checkpoint before completing the session",
      409
    );
  }
  const [updated] = await db
    .update(sessions)
    .set({ status: SESSION_STATUS_COMPLETED })
    .where(eq(sessions.id, opts.sessionId))
    .returning();
  return updated;
}

/**
 * Mechanical playbook extraction — records agents used + checkpoints fired
 * in occurrence order. Proves the pipeline; does not generalize a reusable
 * pattern the way a real model would.
 */
export function mechanicalExtractSteps(opts: {
  agentId: string | null;
  events: Array<{
    eventType: string;
    sequenceNumber: number;
    payload: unknown;
  }>;
  runAgentIds: string[];
}): PatternStep[] {
  const steps: PatternStep[] = [];
  const emittedAgents = new Set<string>();

  if (opts.agentId) {
    steps.push({
      agent_id: opts.agentId,
      label: "Bound agent",
      checkpoint_policy_id: null,
      role: null,
    });
    emittedAgents.add(opts.agentId);
  }

  for (const event of opts.events) {
    if (event.eventType !== "checkpoint_raised") continue;
    const payload =
      event.payload &&
      typeof event.payload === "object" &&
      !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : {};
    const policyId =
      typeof payload.policy_id === "string" ? payload.policy_id : null;
    if (!policyId) continue;
    const policyName =
      typeof payload.policy_name === "string"
        ? payload.policy_name
        : "Checkpoint";
    steps.push({
      agent_id: opts.agentId,
      checkpoint_policy_id: policyId,
      label: `Checkpoint: ${policyName}`,
      role: null,
    });
  }

  for (const agentId of opts.runAgentIds) {
    if (emittedAgents.has(agentId)) continue;
    steps.push({
      agent_id: agentId,
      label: "Agent run",
      checkpoint_policy_id: null,
      role: null,
    });
    emittedAgents.add(agentId);
  }

  if (steps.length === 0) {
    steps.push({
      role: "owner",
      label: "Human-led (no agent/checkpoint recorded)",
      agent_id: null,
      checkpoint_policy_id: null,
    });
  }

  return steps;
}

function parseLlmSteps(text: string): PatternStep[] | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as PatternStep[];
  } catch {
    return null;
  }
}

async function llmExtractSteps(opts: {
  title: string | null;
  events: Array<{
    eventType: string;
    sequenceNumber: number;
    payload: unknown;
  }>;
  agentId: string | null;
}): Promise<PatternStep[] | null> {
  const apiKey =
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) return null;

  const anthropic = createAnthropic({
    apiKey,
    baseURL:
      process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
  });

  const summary = opts.events
    .slice(0, 80)
    .map((e) => {
      const p =
        e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
          ? (e.payload as Record<string, unknown>)
          : {};
      const bits = [
        `#${e.sequenceNumber}`,
        e.eventType,
        typeof p.policy_id === "string" ? `policy=${p.policy_id}` : "",
        typeof p.policy_name === "string" ? p.policy_name : "",
        typeof p.content === "string" ? p.content.slice(0, 80) : "",
      ].filter(Boolean);
      return bits.join(" ");
    })
    .join("\n");

  const result = await generateText({
    model: anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5"),
    prompt: `Extract a reusable workflow pattern from this completed Multiplayer AI session.
Session title: ${opts.title ?? "Untitled"}
Bound agent_id: ${opts.agentId ?? "none"}

Event log (abbreviated):
${summary}

Return ONLY a JSON array of steps. Each step object may include:
agent_id (uuid string or null), role (owner|pilot|reviewer|observer or null),
checkpoint_policy_id (uuid string or null), label (short string).
Generalize — do not copy one-off incidental details. Prefer 2–6 steps.`,
  });

  return parseLlmSteps(result.text);
}

/**
 * "Make this repeatable" — write a workflow_patterns row from a completed session.
 * Mock mode: mechanical extraction. Real mode: LLM with mechanical fallback.
 */
export async function extractPlaybookFromSession(opts: {
  orgId: string;
  sessionId: string;
  actorId: string;
  name?: string | null;
}): Promise<{
  pattern: WorkflowPatternRow;
  extraction: "mechanical" | "llm";
}> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.id, opts.sessionId), eq(sessions.orgId, opts.orgId))
    )
    .limit(1);

  if (!session) {
    throw new AuthError("Session not found", 404);
  }
  if (session.status !== SESSION_STATUS_COMPLETED) {
    throw new AuthError(
      "Session must be completed before extracting a playbook",
      400
    );
  }

  const events = await listSessionEvents(opts.sessionId, 0);
  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.sessionId, opts.sessionId))
    .orderBy(asc(agentRuns.startedAt));
  const runAgentIds = [
    ...new Set(runs.map((r) => r.agentId).filter(Boolean)),
  ];

  let steps: PatternStep[];
  let extraction: "mechanical" | "llm" = "mechanical";

  if (isMockAiEnabled()) {
    steps = mechanicalExtractSteps({
      agentId: session.agentId,
      events,
      runAgentIds,
    });
  } else {
    const llmSteps = await llmExtractSteps({
      title: session.title,
      events,
      agentId: session.agentId,
    });
    if (llmSteps && llmSteps.length > 0) {
      steps = llmSteps;
      extraction = "llm";
    } else {
      steps = mechanicalExtractSteps({
        agentId: session.agentId,
        events,
        runAgentIds,
      });
    }
  }

  const name =
    opts.name?.trim() ||
    `Playbook: ${session.title?.trim() || "Untitled session"}`;

  const pattern = await createPattern({
    orgId: opts.orgId,
    name,
    steps,
    isPublic: false,
    createdFromSessionId: opts.sessionId,
  });

  await appendSessionEvent({
    sessionId: opts.sessionId,
    eventType: "playbook_extracted",
    actorId: opts.actorId,
    actorType: "human",
    payload: {
      pattern_id: pattern.id,
      pattern_name: pattern.name,
      extraction,
      mock: isMockAiEnabled(),
      steps: pattern.steps,
    },
  });

  return { pattern, extraction };
}
