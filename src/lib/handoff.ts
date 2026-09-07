import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { AuthError } from "@/lib/auth-error";
import { listPendingCheckpoints } from "@/lib/checkpoints";
import { appendSessionEvent, listSessionEvents, type SessionEventRow } from "@/lib/events";
import { isMockAiEnabled } from "@/lib/mock-ai";
import { usageWithCost } from "@/lib/pricing";

export const MOCK_HANDOFF_PREFIX = "[MOCK HANDOFF BRIEF]";

function payloadContent(payload: unknown): string {
  if (payload && typeof payload === "object" && "content" in payload) {
    const content = (payload as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  if (payload && typeof payload === "object" && "summary" in payload) {
    const summary = (payload as { summary: unknown }).summary;
    if (typeof summary === "string") return summary;
  }
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

function eventLine(event: SessionEventRow): string {
  const body = payloadContent(event.payload);
  const clipped = body.length > 200 ? `${body.slice(0, 200)}…` : body;
  return `#${event.sequenceNumber} [${event.eventType}] ${clipped}`;
}

function sliceSinceLastHandoff(events: SessionEventRow[]): {
  sinceSequence: number;
  window: SessionEventRow[];
} {
  let lastHandoffSeq = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].eventType === "handoff_brief") {
      lastHandoffSeq = events[i].sequenceNumber;
      break;
    }
  }
  const window = events.filter((e) => e.sequenceNumber > lastHandoffSeq);
  return { sinceSequence: lastHandoffSeq, window };
}

function buildMockHandoffSummary(
  window: SessionEventRow[],
  sinceSequence: number
): string {
  const highlights = window
    .filter((e) =>
      ["user_message", "agent_message", "checkpoint_raised", "suggestion"].includes(
        e.eventType
      )
    )
    .slice(-8)
    .map(eventLine);

  const lines = [
    MOCK_HANDOFF_PREFIX,
    sinceSequence === 0
      ? "Coverage: from session start."
      : `Coverage: events after handoff #${sinceSequence}.`,
    `Events in window: ${window.length}.`,
    highlights.length > 0 ? "Highlights:" : "No notable events since last handoff.",
    ...highlights.map((h) => `- ${h}`),
  ];
  return lines.join("\n");
}

async function buildRealHandoffSummary(
  window: SessionEventRow[],
  sinceSequence: number
): Promise<{ text: string; tokenUsage: Record<string, number> }> {
  const apiKey =
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) is not set — add it to .env.local and restart the dev server"
    );
  }

  const anthropic = createAnthropic({
    apiKey,
    baseURL:
      process.env.MULTIPLAYER_AI_ANTHROPIC_BASE_URL ||
      "https://api.anthropic.com/v1",
  });

  const transcript = window.map(eventLine).join("\n");
  const result = await generateText({
    model: anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5"),
    system:
      "You write concise async handoff briefs for a multiplayer AI work session. " +
      "Summarize what happened since the last handoff, open decisions, and suggested next steps. " +
      "Do not invent events that are not in the transcript.",
    prompt:
      (sinceSequence === 0
        ? "Summarize the session so far.\n\n"
        : `Summarize events after sequence #${sinceSequence}.\n\n`) +
      (transcript || "(no events)"),
  });

  return {
    text: result.text,
    tokenUsage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    },
  };
}

/**
 * Generate and append a handoff_brief for a session.
 * Mock vs real follows the same MOCK_AI_RESPONSES gate as Steps 4/7.
 */
export async function generateHandoffBrief(opts: {
  sessionId: string;
  actorId: string | null;
  trigger: "on_demand" | "scheduled";
}): Promise<SessionEventRow> {
  const events = await listSessionEvents(opts.sessionId, 0);
  const { sinceSequence, window } = sliceSinceLastHandoff(events);

  if (window.length === 0) {
    throw new AuthError("No new events since the last handoff brief", 400);
  }

  const throughSequence = window[window.length - 1].sequenceNumber;
  let summary: string;
  let tokenUsage: Record<string, number> | null = null;
  let costUsd: string | null = null;
  let mock = false;

  if (isMockAiEnabled()) {
    mock = true;
    summary = buildMockHandoffSummary(window, sinceSequence);
    const inputTokens = 64 + Math.min(window.length * 12, 400);
    const outputTokens = 48 + Math.min(summary.length, 200);
    const priced = usageWithCost(inputTokens, outputTokens);
    tokenUsage = priced.tokenUsage;
    costUsd = priced.costUsd;
  } else {
    const real = await buildRealHandoffSummary(window, sinceSequence);
    summary = real.text;
    const priced = usageWithCost(
      real.tokenUsage.inputTokens ?? 0,
      real.tokenUsage.outputTokens ?? 0
    );
    tokenUsage = priced.tokenUsage;
    costUsd = priced.costUsd;
  }

  // Guard: mock summaries must stay clearly labeled.
  if (mock && !summary.includes(MOCK_HANDOFF_PREFIX)) {
    summary = `${MOCK_HANDOFF_PREFIX}\n${summary}`;
  }

  return appendSessionEvent({
    sessionId: opts.sessionId,
    eventType: "handoff_brief",
    actorId: opts.actorId,
    actorType: opts.actorId ? "human" : "agent",
    payload: {
      summary,
      since_sequence: sinceSequence,
      through_sequence: throughSequence,
      event_count: window.length,
      trigger: opts.trigger,
      mock,
    },
    tokenUsage,
    costUsd,
  });
}

/** Active sessions eligible for scheduled handoffs. */
export async function listActiveSessionsForHandoff(): Promise<
  Array<{ id: string }>
> {
  return db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.status, "active"));
}

/**
 * Cron/worker entry: attempt a handoff for each active session that has
 * new events since the last brief. Failures are logged per session.
 */
export async function runScheduledHandoffs(): Promise<{
  attempted: number;
  created: number;
  skipped: number;
  errors: number;
}> {
  const rows = await listActiveSessionsForHandoff();
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      await generateHandoffBrief({
        sessionId: row.id,
        actorId: null,
        trigger: "scheduled",
      });
      created += 1;
    } catch (error) {
      if (
        error instanceof AuthError &&
        error.message.includes("No new events")
      ) {
        skipped += 1;
      } else {
        errors += 1;
        console.error("[handoff cron]", row.id, error);
      }
    }
  }

  return {
    attempted: rows.length,
    created,
    skipped,
    errors,
  };
}

export async function getPendingDecisions(sessionId: string) {
  const pending = await listPendingCheckpoints(sessionId);
  return {
    pendingCheckpoints: pending.map((event) => {
      const payload = event.payload as Record<string, unknown>;
      return {
        id: event.id,
        sequenceNumber: event.sequenceNumber,
        policyName:
          typeof payload.policy_name === "string"
            ? payload.policy_name
            : "Checkpoint",
        requiredRole:
          typeof payload.required_role === "string"
            ? payload.required_role
            : null,
        reason:
          typeof payload.reason === "string" ? payload.reason : null,
        createdAt: event.createdAt,
      };
    }),
  };
}
