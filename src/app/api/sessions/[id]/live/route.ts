import { jsonError, requireActor } from "@/lib/auth";
import {
  createRedisSubscriber,
  sessionChannel,
} from "@/lib/realtime";
import type { LiveSessionEventPayload } from "@/lib/realtime-types";
import { requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/sessions/:id/live
 * SSE live channel backed by Redis pub/sub on `session:{id}`.
 * Clients must fetch GET /events history first, then open this stream (late-join).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id: sessionId } = await context.params;
    await requireSessionAccess(actor.user, sessionId, actor.guestSessionId);

    const channel = sessionChannel(sessionId);
    const subscriber = createRedisSubscriber();
    await subscriber.connect();
    await subscriber.subscribe(channel);

    const encoder = new TextEncoder();
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          if (closed) return;
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        send("ready", { session_id: sessionId, channel });

        const onMessage = (ch: string, message: string) => {
          if (ch !== channel || closed) return;
          try {
            const parsed = JSON.parse(message) as LiveSessionEventPayload;
            send("session_event", parsed);
          } catch (error) {
            console.error("[live] bad redis payload", error);
          }
        };

        subscriber.on("message", onMessage);

        heartbeat = setInterval(() => {
          send("ping", { t: Date.now() });
        }, 15000);

        const abort = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          subscriber.off("message", onMessage);
          void subscriber.unsubscribe(channel).finally(() => {
            subscriber.disconnect();
          });
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        request.signal.addEventListener("abort", abort);
      },
      cancel() {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        void subscriber.unsubscribe(channel).finally(() => {
          subscriber.disconnect();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
