import {
  createTextStreamResponse,
  generateText,
  streamText,
  toTextStream,
  type ModelMessage,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import {
  completeAgentRun,
  getOrgAgent,
  startAgentRun,
} from "@/lib/agents";
import { assertSessionNotPausedForWrites } from "@/lib/checkpoints";
import { appendSessionEvent, listSessionEvents } from "@/lib/events";
import {
  createMockAgentStreamResponse,
  isMockAiEnabled,
  runMockAgentTurn,
  type AgentTurnOutcome,
} from "@/lib/mock-ai";
import { usageWithCost } from "@/lib/pricing";

const DEFAULT_SYSTEM_PROMPT =
  "You are the AI co-pilot in a Multiplayer AI work session. " +
  "Respond helpfully and concisely to the team's latest message, " +
  "using prior session events as context.";

export type { AgentTurnOutcome };

async function assertAgentTurnAllowed(sessionId: string) {
  const [session] = await db
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!session) {
    throw new Error("Session not found");
  }
  assertSessionNotPausedForWrites(session);
}

async function resolveSessionAgentConfig(sessionId: string): Promise<{
  systemPrompt: string;
  modelId: string;
  modelProvider: string;
}> {
  const [session] = await db
    .select({
      agentId: sessions.agentId,
      orgId: sessions.orgId,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (session?.agentId && session.orgId) {
    const agent = await getOrgAgent(session.orgId, session.agentId);
    if (agent) {
      return {
        systemPrompt: agent.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
        modelId: agent.modelId,
        modelProvider: agent.modelProvider,
      };
    }
  }

  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    modelId: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    modelProvider: "anthropic",
  };
}

function anthropicClient() {
  const apiKey =
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) is not set — add it to .env.local and restart the dev server"
    );
  }

  const baseURL =
    process.env.MULTIPLAYER_AI_ANTHROPIC_BASE_URL ||
    "https://api.anthropic.com/v1";

  return createAnthropic({
    apiKey,
    baseURL,
  });
}

function payloadContent(payload: unknown): string {
  if (payload && typeof payload === "object" && "content" in payload) {
    const content = (payload as { content: unknown }).content;
    if (typeof content === "string") {
      return content;
    }
  }
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export function historyToMessages(
  events: Awaited<ReturnType<typeof listSessionEvents>>
): ModelMessage[] {
  const messages: ModelMessage[] = [];

  for (const event of events) {
    if (event.eventType === "user_message") {
      messages.push({
        role: "user",
        content: payloadContent(event.payload),
      });
    } else if (event.eventType === "agent_message") {
      messages.push({
        role: "assistant",
        content: payloadContent(event.payload),
      });
    }
  }

  return messages;
}

/** Real Anthropic path — buffered (Step 4). No mock branches inside. */
async function runRealAgentTurn(sessionId: string): Promise<AgentTurnOutcome> {
  const anthropic = anthropicClient();
  const history = await listSessionEvents(sessionId, 0);
  const messages = historyToMessages(history);
  const config = await resolveSessionAgentConfig(sessionId);

  if (messages.length === 0) {
    throw new Error("No messages to respond to");
  }

  if (config.modelProvider !== "anthropic") {
    throw new Error(
      `Model provider "${config.modelProvider}" is not wired for live calls yet — use anthropic or mock mode`
    );
  }

  const result = await generateText({
    model: anthropic(config.modelId),
    system: config.systemPrompt,
    messages,
  });

  const { tokenUsage, costUsd } = usageWithCost(
    result.usage.inputTokens ?? 0,
    result.usage.outputTokens ?? 0
  );

  const event = await appendSessionEvent({
    sessionId,
    eventType: "agent_message",
    actorId: null,
    actorType: "agent",
    payload: { content: result.text },
    tokenUsage,
    costUsd,
  });

  return { event, paused: false, checkpoint: null };
}

/**
 * Step 4 buffered loop. Mock vs real is a single early return.
 * Outcome may be paused when a mock tool call requires a Tool Mesh checkpoint.
 * Starts/completes agent_runs when the session is bound to a Fleet agent.
 */
export async function runAgentTurn(
  sessionId: string
): Promise<AgentTurnOutcome> {
  await assertAgentTurnAllowed(sessionId);
  const run = await startAgentRun(sessionId);
  try {
    const outcome = isMockAiEnabled()
      ? await runMockAgentTurn(sessionId)
      : await runRealAgentTurn(sessionId);
    if (run) {
      await completeAgentRun(
        run.id,
        outcome.paused ? "escalated" : "success"
      );
    }
    return outcome;
  } catch (error) {
    if (run) {
      try {
        await completeAgentRun(run.id, "failure");
      } catch {
        /* preserve original error */
      }
    }
    throw error;
  }
}

/**
 * Step 7 streaming loop. Returns an HTTP text stream; writes one agent event
 * when the stream completes. Mock vs real is a single early return.
 */
export async function streamAgentTurnResponse(
  sessionId: string
): Promise<Response> {
  await assertAgentTurnAllowed(sessionId);
  const run = await startAgentRun(sessionId);

  const finishRun = async (outcome: "success" | "failure" | "escalated") => {
    if (!run) return;
    try {
      await completeAgentRun(run.id, outcome);
    } catch {
      /* ignore secondary errors */
    }
  };

  try {
    if (isMockAiEnabled()) {
      return createMockAgentStreamResponse(sessionId, {
        onEscalated: () => finishRun("escalated"),
        onSuccess: () => finishRun("success"),
        onFailure: () => finishRun("failure"),
      });
    }

    const anthropic = anthropicClient();
    const history = await listSessionEvents(sessionId, 0);
    const messages = historyToMessages(history);
    const config = await resolveSessionAgentConfig(sessionId);

    if (messages.length === 0) {
      await finishRun("failure");
      throw new Error("No messages to respond to");
    }

    if (config.modelProvider !== "anthropic") {
      await finishRun("failure");
      throw new Error(
        `Model provider "${config.modelProvider}" is not wired for live calls yet — use anthropic or mock mode`
      );
    }

    const result = streamText({
      model: anthropic(config.modelId),
      system: config.systemPrompt,
      messages,
      onFinish: async ({ text, usage }) => {
        const { tokenUsage, costUsd } = usageWithCost(
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0
        );
        await appendSessionEvent({
          sessionId,
          eventType: "agent_message",
          actorId: null,
          actorType: "agent",
          payload: { content: text },
          tokenUsage,
          costUsd,
        });
        await finishRun("success");
      },
      onError: async () => {
        await finishRun("failure");
      },
    });

    return createTextStreamResponse({
      stream: toTextStream({ stream: result.stream }),
    });
  } catch (error) {
    await finishRun("failure");
    throw error;
  }
}
