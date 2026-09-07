import { AuthError } from "@/lib/auth-error";
import type { SessionEventRow } from "@/lib/events";
import { appendSessionEvent, listSessionEvents } from "@/lib/events";
import {
  authorizeToolInvocation,
  getSessionOrgId,
} from "@/lib/tool-mesh";
import { usageWithCost } from "@/lib/pricing";
import { createTextStreamResponse } from "ai";

export const MOCK_RESPONSE_PREFIX = "[MOCK RESPONSE]";

export type MockAgentMessageResult = {
  eventType: "agent_message";
  payload: { content: string };
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: string;
};

export type MockToolCallResult = {
  eventType: "agent_tool_call";
  payload: {
    tool_call_id: string;
    tool_name: string;
    arguments: Record<string, unknown>;
  };
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: string;
};

export type MockAgentResult = MockAgentMessageResult | MockToolCallResult;

export type AgentTurnOutcome = {
  event: SessionEventRow | null;
  paused: boolean;
  checkpoint: SessionEventRow | null;
};

/** True unless MOCK_AI_RESPONSES is explicitly set to "false". */
export function isMockAiEnabled() {
  return process.env.MOCK_AI_RESPONSES !== "false";
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

function lastUserContent(
  events: Awaited<ReturnType<typeof listSessionEvents>>
): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].eventType === "user_message") {
      return payloadContent(events[i].payload);
    }
  }
  return "";
}

/**
 * Build a canned mock model turn. Completely separate from the real Anthropic path.
 *
 * Tool-call exercise: include `[mock_tool:<name>]` in the latest user_message
 * (optional args JSON after a space), e.g. `[mock_tool:github] {"repo":"acme/app"}`.
 */
export function buildMockAgentResult(lastUserMessage: string): MockAgentResult {
  const toolMatch = lastUserMessage.match(
    /\[mock_tool:([a-zA-Z0-9_-]+)\](?:\s*(\{[\s\S]*\}))?/
  );

  // Realistic-looking fake counts; cost uses the shared Sonnet 5 pricing formula.
  const inputTokens = 128 + Math.min(lastUserMessage.length, 400);
  const outputTokens = toolMatch ? 32 : 64 + (lastUserMessage.length % 40);
  const { tokenUsage, costUsd } = usageWithCost(inputTokens, outputTokens);

  if (toolMatch) {
    const toolName = toolMatch[1];
    let args: Record<string, unknown> = { mock: true };
    if (toolMatch[2]) {
      try {
        const parsed = JSON.parse(toolMatch[2]) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = { mock: true, raw: toolMatch[2] };
      }
    }

    return {
      eventType: "agent_tool_call",
      payload: {
        tool_call_id: `mock_tool_${Date.now()}`,
        tool_name: toolName,
        arguments: args,
      },
      tokenUsage,
      costUsd,
    };
  }

  const body = lastUserMessage.trim() || "(empty message)";
  const content = `${MOCK_RESPONSE_PREFIX} Acknowledged: ${body}`;
  const withSentenceEnd = /[.!?…]$/.test(content) ? content : `${content}.`;
  return {
    eventType: "agent_message",
    payload: {
      content: withSentenceEnd,
    },
    tokenUsage,
    costUsd,
  };
}

async function appendBlockedToolMessage(
  sessionId: string,
  toolName: string,
  reason: string,
  tokenUsage: MockAgentResult["tokenUsage"],
  costUsd: string
) {
  return appendSessionEvent({
    sessionId,
    eventType: "agent_message",
    actorId: null,
    actorType: "agent",
    payload: {
      content: `${MOCK_RESPONSE_PREFIX} Tool call blocked: ${reason}`,
      blocked_tool: toolName,
      blocked: true,
    },
    tokenUsage,
    costUsd,
  });
}

/**
 * Apply Tool Mesh permission gate to a mock tool-call result.
 */
export async function resolveMockAgentResult(
  sessionId: string,
  mock: MockAgentResult
): Promise<AgentTurnOutcome> {
  if (mock.eventType !== "agent_tool_call") {
    const event = await appendSessionEvent({
      sessionId,
      eventType: mock.eventType,
      actorId: null,
      actorType: "agent",
      payload: mock.payload,
      tokenUsage: mock.tokenUsage,
      costUsd: mock.costUsd,
    });
    return { event, paused: false, checkpoint: null };
  }

  const orgId = await getSessionOrgId(sessionId);
  const authz = await authorizeToolInvocation({
    orgId,
    sessionId,
    toolName: mock.payload.tool_name,
  });

  if (authz.decision === "block") {
    const event = await appendBlockedToolMessage(
      sessionId,
      mock.payload.tool_name,
      authz.reason,
      mock.tokenUsage,
      mock.costUsd
    );
    return { event, paused: false, checkpoint: null };
  }

  if (authz.decision === "checkpoint") {
    return {
      event: null,
      paused: true,
      checkpoint: authz.checkpoint,
    };
  }

  const event = await appendSessionEvent({
    sessionId,
    eventType: mock.eventType,
    actorId: null,
    actorType: "agent",
    payload: mock.payload,
    tokenUsage: mock.tokenUsage,
    costUsd: mock.costUsd,
  });
  return { event, paused: false, checkpoint: null };
}

/**
 * Mock agent turn — buffered (Step 4). Early-return target from runAgentTurn.
 * Tool calls go through Tool Mesh permission checks (Step 14).
 */
export async function runMockAgentTurn(
  sessionId: string
): Promise<AgentTurnOutcome> {
  const history = await listSessionEvents(sessionId, 0);
  if (history.length === 0) {
    throw new Error("No messages to respond to");
  }

  const mock = buildMockAgentResult(lastUserContent(history));
  return resolveMockAgentResult(sessionId, mock);
}

/** Split canned mock text into small chunks so the UI can exercise streaming. */
export function chunkMockText(text: string, chunkSize = 4): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}

function mockChunkDelayMs(chunkCount: number, preferredMs: number): number {
  const budgetMs = 12_000;
  if (chunkCount <= 1) return 0;
  return Math.max(2, Math.min(preferredMs, Math.floor(budgetMs / chunkCount)));
}

async function enqueueMockChunks(
  controller: ReadableStreamDefaultController<string>,
  text: string,
  chunkSize: number,
  preferredDelayMs: number
) {
  const chunks = chunkMockText(text, chunkSize);
  const delayMs = mockChunkDelayMs(chunks.length, preferredDelayMs);
  let i = 0;
  for (const chunk of chunks) {
    i += 1;
    console.log(
      "[mock-stream server]",
      new Date().toISOString(),
      `chunk=${i}/${chunks.length}`,
      `len=${chunk.length}`,
      JSON.stringify(chunk)
    );
    controller.enqueue(chunk);
    if (delayMs > 0 && i < chunks.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Mock streaming turn (Step 7). Tool calls are permission-gated before emit.
 * Checkpoint / restricted outcomes return JSON 409 / short text instead of a tool event.
 */
export async function createMockAgentStreamResponse(
  sessionId: string,
  hooks?: {
    onEscalated?: () => Promise<void>;
    onSuccess?: () => Promise<void>;
    onFailure?: () => Promise<void>;
  }
): Promise<Response> {
  const history = await listSessionEvents(sessionId, 0);
  if (history.length === 0) {
    throw new Error("No messages to respond to");
  }

  const mock = buildMockAgentResult(lastUserContent(history));

  const wrapStream = (
    build: (
      controller: ReadableStreamDefaultController<string>
    ) => Promise<void>
  ) =>
    new ReadableStream<string>({
      async start(controller) {
        try {
          await build(controller);
          await hooks?.onSuccess?.();
        } catch (error) {
          await hooks?.onFailure?.();
          controller.error(error);
        }
      },
    });

  if (mock.eventType === "agent_tool_call") {
    const orgId = await getSessionOrgId(sessionId);
    const authz = await authorizeToolInvocation({
      orgId,
      sessionId,
      toolName: mock.payload.tool_name,
    });

    if (authz.decision === "checkpoint") {
      await hooks?.onEscalated?.();
      return Response.json(
        {
          paused: true,
          checkpoint: authz.checkpoint,
          error: "Checkpoint raised — tool call paused until resolved",
        },
        { status: 409 }
      );
    }

    if (authz.decision === "block") {
      const text = `${MOCK_RESPONSE_PREFIX} Tool call blocked: ${authz.reason}`;
      const stream = wrapStream(async (controller) => {
        await enqueueMockChunks(controller, text, 6, 30);
        controller.close();
        await appendSessionEvent({
          sessionId,
          eventType: "agent_message",
          actorId: null,
          actorType: "agent",
          payload: {
            content: text,
            blocked_tool: mock.payload.tool_name,
            blocked: true,
          },
          tokenUsage: mock.tokenUsage,
          costUsd: mock.costUsd,
        });
      });
      return createTextStreamResponse({
        stream,
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const marker = `${MOCK_RESPONSE_PREFIX} Calling tool ${mock.payload.tool_name}…`;
    const stream = wrapStream(async (controller) => {
      await enqueueMockChunks(controller, marker, 6, 30);
      controller.close();
      await appendSessionEvent({
        sessionId,
        eventType: mock.eventType,
        actorId: null,
        actorType: "agent",
        payload: mock.payload,
        tokenUsage: mock.tokenUsage,
        costUsd: mock.costUsd,
      });
    });
    return createTextStreamResponse({
      stream,
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const text = mock.payload.content;
  const stream = wrapStream(async (controller) => {
    await enqueueMockChunks(controller, text, 4, 35);
    controller.close();
    await appendSessionEvent({
      sessionId,
      eventType: "agent_message",
      actorId: null,
      actorType: "agent",
      payload: { content: text },
      tokenUsage: mock.tokenUsage,
      costUsd: mock.costUsd,
    });
  });

  return createTextStreamResponse({
    stream,
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** @deprecated kept for AuthError typing imports if needed */
export function assertMockConfigured() {
  if (!isMockAiEnabled()) {
    throw new AuthError("Mock AI is disabled", 400);
  }
}
