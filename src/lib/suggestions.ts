import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessionEvents } from "@/db/schema";
import { AuthError } from "@/lib/auth-error";
import { streamAgentTurnResponse } from "@/lib/agent-loop";
import { appendSessionEvent, type SessionEventRow } from "@/lib/events";

export async function getSessionEvent(
  sessionId: string,
  eventId: string
): Promise<SessionEventRow | null> {
  const [row] = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.id, eventId))
    .limit(1);

  if (!row || row.sessionId !== sessionId) {
    return null;
  }
  return row;
}

function suggestionContent(event: SessionEventRow): string {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.content === "string" && payload.content.trim()) {
    return payload.content.trim();
  }
  throw new AuthError("Suggestion has no content", 400);
}

/**
 * Pilot/owner accepts a pending suggestion → suggestion_accepted + user_message,
 * then streams the agent reply (same path as POST .../stream).
 */
export async function acceptSuggestion(opts: {
  sessionId: string;
  suggestionEventId: string;
  actorId: string;
}): Promise<Response> {
  const suggestion = await getSessionEvent(
    opts.sessionId,
    opts.suggestionEventId
  );
  if (!suggestion || suggestion.eventType !== "suggestion") {
    throw new AuthError("Suggestion not found", 404);
  }

  const content = suggestionContent(suggestion);

  await appendSessionEvent({
    sessionId: opts.sessionId,
    eventType: "suggestion_accepted",
    actorId: opts.actorId,
    actorType: "human",
    payload: { suggestion_event_id: suggestion.id },
  });

  await appendSessionEvent({
    sessionId: opts.sessionId,
    eventType: "user_message",
    actorId: opts.actorId,
    actorType: "human",
    payload: {
      content,
      from_suggestion_id: suggestion.id,
    },
  });

  return streamAgentTurnResponse(opts.sessionId);
}

export async function dismissSuggestion(opts: {
  sessionId: string;
  suggestionEventId: string;
  actorId: string;
}): Promise<SessionEventRow> {
  const suggestion = await getSessionEvent(
    opts.sessionId,
    opts.suggestionEventId
  );
  if (!suggestion || suggestion.eventType !== "suggestion") {
    throw new AuthError("Suggestion not found", 404);
  }

  return appendSessionEvent({
    sessionId: opts.sessionId,
    eventType: "suggestion_dismissed",
    actorId: opts.actorId,
    actorType: "human",
    payload: { suggestion_event_id: suggestion.id },
  });
}
