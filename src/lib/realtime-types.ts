/** Shared live-channel payload shape (safe for client + server). */

export type LiveSessionEventPayload = {
  session_id: string;
  event: {
    id: string;
    sessionId: string;
    sequenceNumber: number;
    eventType: string;
    actorId: string | null;
    actorType: string;
    payload: Record<string, unknown>;
    tokenUsage: Record<string, unknown> | null;
    costUsd: string | null;
    createdAt: string | null;
  };
};
