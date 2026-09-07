"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type PatternStep = {
  agent_id?: string | null;
  role?: string | null;
  checkpoint_policy_id?: string | null;
  label?: string | null;
};

type Pattern = {
  id: string;
  name: string;
  steps: PatternStep[];
  createdFromSessionId: string | null;
  isPublic: boolean;
  createdAt: string | null;
};

type AgentOpt = { id: string; name: string; version: string; status: string };
type PolicyOpt = { id: string; name: string; active: boolean };

type DraftStep = {
  label: string;
  agent_id: string;
  role: string;
  checkpoint_policy_id: string;
};

const emptyStep = (): DraftStep => ({
  label: "",
  agent_id: "",
  role: "",
  checkpoint_policy_id: "",
});

export default function PatternsClient() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [policies, setPolicies] = useState<PolicyOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([
    emptyStep(),
    emptyStep(),
  ]);
  const [saving, setSaving] = useState(false);
  const [spinningId, setSpinningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [pRes, aRes, polRes] = await Promise.all([
      fetch("/api/org/patterns"),
      fetch("/api/org/agents"),
      fetch("/api/org/checkpoint-policies"),
    ]);
    const pData = (await pRes.json().catch(() => null)) as {
      patterns?: Pattern[];
      error?: string;
    } | null;
    if (!pRes.ok) {
      setError(pData?.error ?? `Failed to load (${pRes.status})`);
      setLoading(false);
      return;
    }
    setPatterns(pData?.patterns ?? []);

    if (aRes.ok) {
      const aData = (await aRes.json()) as {
        agents?: Array<{ agent: AgentOpt }>;
      };
      setAgents(
        (aData.agents ?? [])
          .map((r) => r.agent)
          .filter((a) => a.status === "active")
      );
    }
    if (polRes.ok) {
      const polData = (await polRes.json()) as { policies?: PolicyOpt[] };
      setPolicies((polData.policies ?? []).filter((p) => p.active));
    }
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
      const bodySteps = steps.map((s) => ({
        label: s.label.trim() || null,
        agent_id: s.agent_id || null,
        role: s.role || null,
        checkpoint_policy_id: s.checkpoint_policy_id || null,
      }));
      const res = await fetch("/api/org/patterns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), steps: bodySteps }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Create failed (${res.status})`);
      }
      setName("");
      setSteps([emptyStep(), emptyStep()]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function spinUp(patternId: string) {
    setSpinningId(patternId);
    setError(null);
    try {
      const res = await fetch(`/api/org/patterns/${patternId}/spin-up`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => null)) as {
        session?: { id: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.session?.id) {
        throw new Error(data?.error ?? `Spin-up failed (${res.status})`);
      }
      window.location.href = `/sessions/${data.session.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spin-up failed");
      setSpinningId(null);
    }
  }

  async function removePattern(patternId: string) {
    setError(null);
    const res = await fetch(`/api/org/patterns/${patternId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(data?.error ?? `Delete failed (${res.status})`);
      return;
    }
    await load();
  }

  function agentName(id: string | null | undefined) {
    if (!id) return null;
    const a = agents.find((x) => x.id === id);
    return a ? `${a.name} v${a.version}` : id.slice(0, 8);
  }

  function policyName(id: string | null | undefined) {
    if (!id) return null;
    const p = policies.find((x) => x.id === id);
    return p?.name ?? id.slice(0, 8);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">
            Pattern library
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Manually authored scaffolds — spin up a session pre-wired with
            agent + checkpoint policies. Playbook extraction lands in Step 23.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/sessions" className="text-neutral-600 hover:underline">
            Sessions
          </Link>
          <Link
            href="/settings/agents"
            className="text-neutral-600 hover:underline"
          >
            Agents
          </Link>
          <Link
            href="/settings/policies"
            className="text-neutral-600 hover:underline"
          >
            Policies
          </Link>
        </div>
      </header>

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={onCreate}
        data-testid="pattern-create-form"
        className="mb-8 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-4"
      >
        <h2 className="text-sm font-semibold text-neutral-900">
          Create pattern
        </h2>
        <label className="mt-3 block text-sm">
          <span className="font-medium text-neutral-800">Name</span>
          <input
            data-testid="pattern-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Research → Draft → Review"
            className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </label>

        <div className="mt-4 space-y-3">
          {steps.map((step, idx) => (
            <div
              key={idx}
              className="rounded border border-neutral-200 bg-white px-3 py-3"
              data-testid={`pattern-step-${idx}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Step {idx + 1}
                </span>
                {steps.length > 1 ? (
                  <button
                    type="button"
                    className="text-xs text-neutral-500 underline"
                    onClick={() =>
                      setSteps((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <label className="block text-sm">
                <span className="text-neutral-700">Label (optional)</span>
                <input
                  value={step.label}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((s, i) =>
                        i === idx ? { ...s, label: e.target.value } : s
                      )
                    )
                  }
                  className="mt-1 w-full border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="mt-2 block text-sm">
                <span className="text-neutral-700">Agent</span>
                <select
                  data-testid={`pattern-step-agent-${idx}`}
                  value={step.agent_id}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((s, i) =>
                        i === idx ? { ...s, agent_id: e.target.value } : s
                      )
                    )
                  }
                  className="mt-1 w-full border border-neutral-300 px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} v{a.version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-2 block text-sm">
                <span className="text-neutral-700">Role (optional)</span>
                <select
                  value={step.role}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((s, i) =>
                        i === idx ? { ...s, role: e.target.value } : s
                      )
                    )
                  }
                  className="mt-1 w-full border border-neutral-300 px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  <option value="owner">owner</option>
                  <option value="pilot">pilot</option>
                  <option value="reviewer">reviewer</option>
                  <option value="observer">observer</option>
                </select>
              </label>
              <label className="mt-2 block text-sm">
                <span className="text-neutral-700">Checkpoint policy</span>
                <select
                  data-testid={`pattern-step-policy-${idx}`}
                  value={step.checkpoint_policy_id}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((s, i) =>
                        i === idx
                          ? { ...s, checkpoint_policy_id: e.target.value }
                          : s
                      )
                    )
                  }
                  className="mt-1 w-full border border-neutral-300 px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            onClick={() => setSteps((prev) => [...prev, emptyStep()])}
          >
            Add step
          </button>
          <button
            type="submit"
            data-testid="pattern-create-submit"
            disabled={saving || !name.trim()}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save pattern"}
          </button>
        </div>
      </form>

      <section>
        <h2 className="text-sm font-semibold text-neutral-900">
          Org patterns
        </h2>
        {loading ? (
          <p className="mt-2 text-sm text-neutral-500">Loading…</p>
        ) : patterns.length === 0 ? (
          <p
            className="mt-2 text-sm text-neutral-500"
            data-testid="patterns-empty"
          >
            No patterns yet — create one above.
          </p>
        ) : (
          <ul className="mt-3 space-y-3" data-testid="patterns-list">
            {patterns.map((p) => (
              <li
                key={p.id}
                data-testid={`pattern-row-${p.id}`}
                className="rounded-md border border-neutral-200 bg-white px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-neutral-900">{p.name}</h3>
                    {p.createdFromSessionId ? (
                      <p className="text-xs text-amber-700">
                        Extracted playbook (from session)
                      </p>
                    ) : (
                      <p className="text-xs text-neutral-500">
                        Manually authored
                      </p>
                    )}
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-neutral-700">
                      {(p.steps ?? []).map((s, i) => (
                        <li key={i}>
                          {s.label ? `${s.label}: ` : ""}
                          {s.agent_id
                            ? `agent ${agentName(s.agent_id)}`
                            : s.role
                              ? `role ${s.role}`
                              : "scaffold"}
                          {s.checkpoint_policy_id
                            ? ` · policy ${policyName(s.checkpoint_policy_id)}`
                            : " · no checkpoint"}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-testid={`pattern-spin-up-${p.id}`}
                      disabled={spinningId === p.id}
                      onClick={() => void spinUp(p.id)}
                      className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                    >
                      {spinningId === p.id ? "Starting…" : "New session"}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600"
                      onClick={() => void removePattern(p.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
