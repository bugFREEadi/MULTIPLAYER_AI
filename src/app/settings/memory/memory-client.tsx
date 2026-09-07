"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type MemoryFact = {
  id: string;
  fact: string;
  scope: string;
  scopeId: string | null;
  sourceSessionId: string | null;
  sourceEventSeq: number | null;
  status: string;
  createdAt: string | null;
};

export default function MemoryCurationClient() {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "curated" | "rejected" | "all">(
    "pending"
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/org/memory?status=${filter}`);
    const data = (await res.json().catch(() => null)) as {
      facts?: MemoryFact[];
      error?: string;
    } | null;
    if (!res.ok) {
      setError(data?.error ?? `Failed to load (${res.status})`);
      setLoading(false);
      return;
    }
    setFacts(data?.facts ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function curate(id: string, status: "curated" | "rejected") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/org/memory/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Update failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-500">
            <Link href="/sessions" className="hover:underline">
              Sessions
            </Link>
            {" / "}
            Settings
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Review pending facts before they become authoritative org memory.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/settings/agents" className="text-neutral-600 hover:underline">
            Agents
          </Link>
          <Link href="/settings/tools" className="text-neutral-600 hover:underline">
            Tools
          </Link>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["pending", "curated", "rejected", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded border px-2.5 py-1 text-xs ${
              filter === s
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 text-neutral-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : facts.length === 0 ? (
        <p className="text-sm text-neutral-500">No facts in this view.</p>
      ) : (
        <ul className="space-y-3">
          {facts.map((fact) => (
            <li
              key={fact.id}
              data-testid={`memory-fact-${fact.id}`}
              className="border border-neutral-200 p-4"
            >
              <p className="text-sm text-neutral-900">{fact.fact}</p>
              <p className="mt-2 text-xs text-neutral-500">
                {fact.scope}
                {fact.sourceSessionId ? (
                  <>
                    {" · "}
                    <Link
                      href={`/sessions/${fact.sourceSessionId}`}
                      className="underline"
                    >
                      source session
                    </Link>
                    {fact.sourceEventSeq != null
                      ? ` #${fact.sourceEventSeq}`
                      : null}
                  </>
                ) : null}
                {" · "}
                {fact.status}
              </p>
              {fact.status === "pending" ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === fact.id}
                    onClick={() => void curate(fact.id, "curated")}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === fact.id}
                    onClick={() => void curate(fact.id, "rejected")}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
