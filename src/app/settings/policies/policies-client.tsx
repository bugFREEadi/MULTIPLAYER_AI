"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Policy = {
  id: string;
  name: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  requiredRole: string;
  active: boolean;
};

export default function CheckpointPoliciesClient() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Deploy keyword gate");
  const [keyword, setKeyword] = useState("deploy");
  const [requiredRole, setRequiredRole] = useState("owner");
  const [triggerType, setTriggerType] = useState<"keyword" | "manual">("keyword");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/org/checkpoint-policies");
    const data = (await res.json().catch(() => null)) as {
      policies?: Policy[];
      error?: string;
    } | null;
    if (!res.ok) {
      setError(data?.error ?? `Failed to load (${res.status})`);
      setLoading(false);
      return;
    }
    setPolicies(data?.policies ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const trigger_config =
        triggerType === "keyword" ? { keyword: keyword.trim() } : {};
      const res = await fetch("/api/org/checkpoint-policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          trigger_type: triggerType,
          trigger_config,
          required_role: requiredRole,
          active: true,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Create failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(policy: Policy) {
    setError(null);
    const res = await fetch(`/api/org/checkpoint-policies/${policy.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !policy.active }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setError(data?.error ?? `Toggle failed (${res.status})`);
      return;
    }
    await load();
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <header className="mb-8">
        <Link href="/sessions" className="text-sm text-neutral-500 hover:underline">
          ← Sessions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Checkpoint policies
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Org rules that pause a session before the agent acts. Step 10 supports
          keyword and manual triggers.
        </p>
      </header>

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="mb-10 rounded-md border border-neutral-200 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Create policy
        </h2>
        <form onSubmit={onCreate} className="flex flex-col gap-3">
          <label className="text-sm">
            Name
            <input
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            Trigger type
            <select
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
              value={triggerType}
              onChange={(e) =>
                setTriggerType(e.target.value as "keyword" | "manual")
              }
            >
              <option value="keyword">keyword</option>
              <option value="manual">manual</option>
            </select>
          </label>
          {triggerType === "keyword" ? (
            <label className="text-sm">
              Keyword
              <input
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                required
              />
            </label>
          ) : null}
          <label className="text-sm">
            Required role to resolve
            <select
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
              value={requiredRole}
              onChange={(e) => setRequiredRole(e.target.value)}
            >
              <option value="owner">owner</option>
              <option value="pilot">pilot</option>
              <option value="co_pilot">co_pilot</option>
              <option value="reviewer">reviewer</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Create"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Policies
        </h2>
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : policies.length === 0 ? (
          <p className="text-sm text-neutral-500">No policies yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {policies.map((policy) => (
              <li
                key={policy.id}
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{policy.name}</p>
                  <p className="text-xs text-neutral-500">
                    {policy.triggerType}
                    {policy.triggerType === "keyword" &&
                    typeof policy.triggerConfig.keyword === "string"
                      ? ` · “${policy.triggerConfig.keyword}”`
                      : ""}{" "}
                    · resolve: {policy.requiredRole} ·{" "}
                    {policy.active ? "active" : "inactive"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleActive(policy)}
                  className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs"
                >
                  {policy.active ? "Disable" : "Enable"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
