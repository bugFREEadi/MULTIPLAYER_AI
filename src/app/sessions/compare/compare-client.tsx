"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";

type SessionEvent = {
  id: string;
  sequenceNumber: number;
  eventType: string;
  payload: Record<string, unknown>;
};

type SessionDetail = {
  id: string;
  title: string | null;
  parentSessionId?: string | null;
  forkedFromEventSeq?: number | null;
};

function eventLabel(event: SessionEvent): string {
  const payload = event.payload;
  if (typeof payload.content === "string") return payload.content;
  if (event.eventType === "checkpoint_raised") {
    return typeof payload.policy_name === "string"
      ? `checkpoint: ${payload.policy_name}`
      : "checkpoint";
  }
  return event.eventType;
}

function TimelineColumn({
  label,
  session,
  events,
}: {
  label: string;
  session: SessionDetail | null;
  events: SessionEvent[];
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border border-neutral-200 bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-neutral-500">
          {label}
        </p>
        <h2 className="truncate text-sm font-semibold">
          {session?.title?.trim() || "Untitled"}
        </h2>
        {session ? (
          <Link
            href={`/sessions/${session.id}`}
            className="font-mono text-[11px] text-neutral-500 underline"
          >
            {session.id.slice(0, 8)}…
          </Link>
        ) : null}
      </header>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {events.map((event) => (
          <li
            key={event.id}
            className="rounded border border-neutral-200 bg-white px-2 py-1.5"
          >
            <p className="text-[10px] uppercase tracking-wide text-neutral-500">
              #{event.sequenceNumber} · {event.eventType}
            </p>
            <p className="whitespace-pre-wrap text-neutral-900">
              {eventLabel(event)}
            </p>
          </li>
        ))}
        {events.length === 0 ? (
          <li className="text-xs text-neutral-500">No events</li>
        ) : null}
      </ul>
    </section>
  );
}

export default function BranchCompareClient() {
  const search = useSearchParams();
  const router = useRouter();
  const leftId = search.get("left");
  const rightId = search.get("right");
  const rejectId = search.get("reject");

  const [leftSession, setLeftSession] = useState<SessionDetail | null>(null);
  const [rightSession, setRightSession] = useState<SessionDetail | null>(null);
  const [leftEvents, setLeftEvents] = useState<SessionEvent[]>([]);
  const [rightEvents, setRightEvents] = useState<SessionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [rejectOther, setRejectOther] = useState(Boolean(rejectId));
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<string | null>(null);
  const [canMerge, setCanMerge] = useState(false);

  const loadSide = useCallback(async (id: string) => {
    const [detailRes, eventsRes] = await Promise.all([
      fetch(`/api/sessions/${id}`),
      fetch(`/api/sessions/${id}/events`),
    ]);
    const detail = (await detailRes.json()) as {
      session?: SessionDetail;
      permissions?: { canMerge?: boolean };
      error?: string;
    };
    const eventsBody = (await eventsRes.json()) as {
      events?: SessionEvent[];
      error?: string;
    };
    if (!detailRes.ok || !detail.session) {
      throw new Error(detail.error ?? `Failed to load session ${id}`);
    }
    if (!eventsRes.ok) {
      throw new Error(eventsBody.error ?? `Failed to load events for ${id}`);
    }
    return {
      session: detail.session,
      events: eventsBody.events ?? [],
      canMerge: Boolean(detail.permissions?.canMerge),
    };
  }, []);

  useEffect(() => {
    if (!leftId || !rightId) {
      setError("Provide ?left=<sessionId>&right=<sessionId>");
      return;
    }
    void (async () => {
      try {
        setError(null);
        const [left, right] = await Promise.all([
          loadSide(leftId),
          loadSide(rightId),
        ]);
        setLeftSession(left.session);
        setLeftEvents(left.events);
        setRightSession(right.session);
        setRightEvents(right.events);
        setCanMerge(left.canMerge);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
  }, [leftId, rightId, loadSide]);

  async function onMerge(e: FormEvent) {
    e.preventDefault();
    if (!leftId || !rightId || !summary.trim()) return;
    setMerging(true);
    setError(null);
    setMergeResult(null);
    try {
      const rejectedBranches =
        rejectOther && rejectId && rejectId !== rightId ? [rejectId] : [];

      const res = await fetch(`/api/sessions/${leftId}/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceSessionId: rightId,
          mergeSummary: summary.trim(),
          rejectedBranches,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        merge?: { id: string; rejectedBranches?: string[] | null };
        error?: string;
      } | null;
      if (!res.ok || !data?.merge) {
        throw new Error(data?.error ?? `Merge failed (${res.status})`);
      }
      setMergeResult(data.merge.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMerging(false);
    }
  }

  if (!leftId || !rightId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-red-700">{error}</p>
        <Link href="/sessions" className="text-sm underline">
          ← Sessions
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-screen max-w-6xl flex-col px-4 py-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm text-neutral-500 hover:underline"
          >
            ← Back
          </button>
          <h1 className="text-lg font-semibold tracking-tight">
            Compare branches
          </h1>
        </div>
        <Link href={`/sessions/${leftId}`} className="text-sm underline">
          Open left
        </Link>
      </header>

      {error ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <TimelineColumn
          label="Left / target"
          session={leftSession}
          events={leftEvents}
        />
        <TimelineColumn
          label="Right / source"
          session={rightSession}
          events={rightEvents}
        />
      </div>

      {canMerge ? (
        <form
          onSubmit={onMerge}
          className="mt-3 space-y-2 border-t border-neutral-200 pt-3"
        >
          <p className="text-sm font-medium">Record merge decision</p>
          <p className="text-xs text-neutral-500">
            Does not auto-merge event content — stores your summary and any
            rejected alternatives for the audit trail.
          </p>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="Merge summary…"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            required
          />
          {rejectId ? (
            <label className="flex items-center gap-2 text-xs text-neutral-700">
              <input
                type="checkbox"
                checked={rejectOther}
                onChange={(e) => setRejectOther(e.target.checked)}
              />
              Mark session {rejectId.slice(0, 8)}… as rejected
            </label>
          ) : (
            <p className="text-xs text-neutral-500">
              Optional: add{" "}
              <code className="rounded bg-neutral-100 px-1">
                &reject=&lt;otherBranchId&gt;
              </code>{" "}
              to the URL to record a rejected alternative.
            </p>
          )}
          <button
            type="submit"
            disabled={merging || !summary.trim()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {merging ? "Saving…" : "Save merge record"}
          </button>
          {mergeResult ? (
            <p className="text-xs text-emerald-700">
              Merge recorded ({mergeResult.slice(0, 8)}…)
            </p>
          ) : null}
        </form>
      ) : null}
    </main>
  );
}
