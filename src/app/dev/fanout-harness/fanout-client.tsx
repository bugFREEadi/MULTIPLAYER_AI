"use client";

/**
 * Dev harness: two browser tabs on ?session=<id> share Redis live fan-out
 * without Clerk (x-dev-clerk-id on every fetch).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSessionLiveChannel } from "@/hooks/use-session-live";
import type { LiveSessionEventPayload } from "@/lib/realtime-types";

const DEV_HEADERS = {
  "x-dev-clerk-id": "step8_fanout_ui",
  "x-dev-user-name": "Fanout UI",
};

type SessionEvent = {
  id: string;
  sequenceNumber: number;
  eventType: string;
  payload: Record<string, unknown>;
};

function mergeEvents(prev: SessionEvent[], incoming: SessionEvent[]) {
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

export default function FanoutHarnessPage() {
  const search = useSearchParams();
  const sessionFromUrl = search.get("session");
  const [sessionId, setSessionId] = useState<string | null>(sessionFromUrl);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [liveReady, setLiveReady] = useState(false);
  const [status, setStatus] = useState("init");
  const [draft, setDraft] = useState("Hello from tab");
  const booted = useRef(false);

  const loadHistory = useCallback(async (id: string) => {
    const res = await fetch(`/api/sessions/${id}/events`, {
      headers: DEV_HEADERS,
    });
    const data = (await res.json()) as { events?: SessionEvent[] };
    setEvents(data.events ?? []);
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      if (sessionFromUrl) {
        setSessionId(sessionFromUrl);
        setStatus("loading-history");
        await loadHistory(sessionFromUrl);
        setLiveReady(true);
        setStatus("live");
        return;
      }
      setStatus("creating");
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", ...DEV_HEADERS },
        body: JSON.stringify({ title: "fanout harness" }),
      });
      const data = (await res.json()) as { session?: { id: string } };
      if (!data.session) {
        setStatus("error creating session");
        return;
      }
      const id = data.session.id;
      setSessionId(id);
      window.history.replaceState({}, "", `?session=${id}`);
      await loadHistory(id);
      setLiveReady(true);
      setStatus("live");
    })();
  }, [loadHistory, sessionFromUrl]);

  useSessionLiveChannel(
    sessionId ?? "",
    liveReady,
    (payload: LiveSessionEventPayload) => {
      const e = payload.event;
      setEvents((prev) =>
        mergeEvents(prev, [
          {
            id: e.id,
            sequenceNumber: e.sequenceNumber,
            eventType: e.eventType,
            payload: e.payload,
          },
        ])
      );
    },
    { headers: DEV_HEADERS }
  );

  async function send() {
    if (!sessionId || !draft.trim()) return;
    setStatus("streaming");
    const res = await fetch(`/api/sessions/${sessionId}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", ...DEV_HEADERS },
      body: JSON.stringify({ prompt: draft.trim() }),
    });
    await res.text();
    setStatus("live");
  }

  return (
    <main className="mx-auto max-w-xl p-6 font-sans">
      <h1 className="text-lg font-semibold">Fan-out harness</h1>
      <p data-testid="status" className="text-sm text-neutral-500">
        {status} {sessionId ? `· ${sessionId.slice(0, 8)}` : ""}
      </p>
      <p className="mt-1 text-xs text-neutral-400">
        Open this URL in a second tab (same ?session=) to watch live events.
      </p>
      <ul data-testid="event-list" className="mt-4 space-y-2 text-sm">
        {events.map((e) => (
          <li
            key={e.id}
            data-testid={`event-${e.eventType}`}
            className="rounded border bg-neutral-50 px-2 py-1"
          >
            #{e.sequenceNumber} {e.eventType}:{" "}
            {typeof e.payload.content === "string"
              ? e.payload.content
              : JSON.stringify(e.payload)}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <input
          data-testid="draft"
          className="flex-1 rounded border px-2 py-1 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          data-testid="send"
          type="button"
          onClick={() => void send()}
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white"
        >
          Send
        </button>
      </div>
    </main>
  );
}
