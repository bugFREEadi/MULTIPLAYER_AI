import Redis from "ioredis";
import type { SessionEventRow } from "@/lib/events";
import type { LiveSessionEventPayload } from "@/lib/realtime-types";

export type { LiveSessionEventPayload } from "@/lib/realtime-types";

const globalForRedis = globalThis as unknown as {
  redisPublisher?: Redis;
};

function redisUrl() {
  return process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
}

/** Shared publisher connection (lazy). */
export function getRedisPublisher(): Redis {
  if (!globalForRedis.redisPublisher) {
    globalForRedis.redisPublisher = new Redis(redisUrl(), {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return globalForRedis.redisPublisher;
}

/** Fresh subscriber — ioredis requires a dedicated connection for SUBSCRIBE. */
export function createRedisSubscriber(): Redis {
  return new Redis(redisUrl(), {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}

export function sessionChannel(sessionId: string) {
  return `session:${sessionId}`;
}

export function serializeSessionEvent(
  row: SessionEventRow
): LiveSessionEventPayload["event"] {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : { value: row.payload };

  return {
    id: row.id,
    sessionId: row.sessionId,
    sequenceNumber: row.sequenceNumber,
    eventType: row.eventType,
    actorId: row.actorId,
    actorType: row.actorType,
    payload,
    tokenUsage:
      row.tokenUsage &&
      typeof row.tokenUsage === "object" &&
      !Array.isArray(row.tokenUsage)
        ? (row.tokenUsage as Record<string, unknown>)
        : null,
    costUsd: row.costUsd != null ? String(row.costUsd) : null,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt
          ? String(row.createdAt)
          : null,
  };
}

/**
 * Publish after a successful session_events insert.
 * Failures are logged but do not roll back the write (Postgres is source of truth).
 */
export async function publishSessionEvent(row: SessionEventRow): Promise<void> {
  const message: LiveSessionEventPayload = {
    session_id: row.sessionId,
    event: serializeSessionEvent(row),
  };

  try {
    const publisher = getRedisPublisher();
    if (publisher.status !== "ready") {
      await publisher.connect();
    }
    await publisher.publish(sessionChannel(row.sessionId), JSON.stringify(message));
  } catch (error) {
    console.error("[realtime] publish failed", row.sessionId, error);
  }
}
