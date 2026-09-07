"use client";

import { useEffect, useState } from "react";
import ArchitectureSessionView from "./architecture-session-view";
import IncidentSessionView from "./incident-session-view";
import SessionViewClient from "./session-view-client";

/**
 * Picks IncidentSessionView / ArchitectureSessionView / generic SessionViewClient
 * from sessions.session_template after the first detail fetch.
 */
export default function SessionRouter({ sessionId }: { sessionId: string }) {
  const [template, setTemplate] = useState<string | null | undefined>(
    undefined
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = (await res.json().catch(() => null)) as {
          session?: { sessionTemplate?: string | null };
          error?: string;
        } | null;
        if (!res.ok || !data?.session) {
          throw new Error(data?.error ?? `Failed to load (${res.status})`);
        }
        if (!cancelled) {
          setTemplate(data.session.sessionTemplate ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setTemplate(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      </main>
    );
  }

  if (template === undefined) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-neutral-500">Loading session…</p>
      </main>
    );
  }

  if (template === "incident_response") {
    return <IncidentSessionView sessionId={sessionId} />;
  }
  if (template === "architecture_decision") {
    return <ArchitectureSessionView sessionId={sessionId} />;
  }
  return <SessionViewClient sessionId={sessionId} />;
}
