"use client";

import { useEffect, useRef } from "react";
import type { LiveSessionEventPayload } from "@/lib/realtime-types";

type Options = {
  /** Extra headers (e.g. x-dev-clerk-id for harnesses). Clerk cookie auth needs none. */
  headers?: Record<string, string>;
};

/**
 * Late-join live channel: call only AFTER history was loaded via GET /events.
 * Uses fetch (not EventSource) so Clerk cookies + optional headers work.
 */
export function useSessionLiveChannel(
  sessionId: string,
  enabled: boolean,
  onSessionEvent: (payload: LiveSessionEventPayload) => void,
  options: Options = {}
) {
  const onEventRef = useRef(onSessionEvent);
  onEventRef.current = onSessionEvent;
  const headersRef = useRef(options.headers);
  headersRef.current = options.headers;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const abort = new AbortController();
    let buffer = "";

    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/live`, {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            ...(headersRef.current ?? {}),
          },
          credentials: "include",
          signal: abort.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) {
          console.error("[live] subscribe failed", res.status);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          for (;;) {
            const sep = buffer.indexOf("\n\n");
            if (sep < 0) break;
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);

            let dataLine = "";
            let eventName = "message";
            for (const line of raw.split("\n")) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLine += line.slice(5).trim();
              }
            }

            if (!dataLine || eventName === "ping" || eventName === "ready") {
              continue;
            }
            if (eventName === "session_event") {
              try {
                const parsed = JSON.parse(dataLine) as LiveSessionEventPayload;
                onEventRef.current(parsed);
              } catch (err) {
                console.error("[live] parse error", err);
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.error("[live] connection error", err);
      }
    })();

    return () => abort.abort();
  }, [sessionId, enabled]);
}
