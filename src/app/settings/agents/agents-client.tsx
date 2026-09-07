"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type AgentMetrics = {
  agentId: string;
  runCount: number;
  successCount: number;
  failureCount: number;
  escalatedCount: number;
  failRate: number;
  avgDurationMs: number | null;
  avgCostUsd: number;
  lastUsedAt: string | null;
};

type AgentRow = {
  id: string;
  name: string;
  version: string;
  modelProvider: string;
  modelId: string;
  systemPrompt: string | null;
  ownerId: string | null;
  status: string;
  createdAt: string | null;
};

type FleetItem = {
  agent: AgentRow;
  metrics: AgentMetrics;
  owner: { id: string; name: string | null; email: string | null } | null;
};

type PublicTool = {
  id: string;
  toolName: string;
  permission: "allowed" | "restricted" | "requires_checkpoint";
  agentPermissions: Array<{
    agentId: string;
    permission: "allowed" | "restricted" | "requires_checkpoint";
  }>;
};

function fmtDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function fmtCost(n: number) {
  return `$${n.toFixed(6)}`;
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(0)}%`;
}

export default function AgentsClient() {
  const [items, setItems] = useState<FleetItem[]>([]);
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [modelProvider, setModelProvider] = useState("anthropic");
  const [modelId, setModelId] = useState("claude-sonnet-5");
  const [systemPrompt, setSystemPrompt] = useState("");

  const load = useCallback(async () => {
    setError(null);
    const [agentsRes, toolsRes] = await Promise.all([
      fetch("/api/org/agents"),
      fetch("/api/org/tools"),
    ]);
    const agentsData = (await agentsRes.json().catch(() => null)) as {
      agents?: FleetItem[];
      error?: string;
    } | null;
    const toolsData = (await toolsRes.json().catch(() => null)) as {
      tools?: PublicTool[];
    } | null;

    if (!agentsRes.ok) {
      setError(agentsData?.error ?? `Failed to load (${agentsRes.status})`);
      setLoading(false);
      return;
    }
    setItems(agentsData?.agents ?? []);
    setTools(toolsData?.tools ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          version,
          model_provider: modelProvider,
          model_id: modelId,
          system_prompt: systemPrompt || null,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Create failed (${res.status})`);
      }
      setName("");
      setSystemPrompt("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(agentId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/agents/${agentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Deactivate failed (${res.status})`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deactivate failed");
    } finally {
      setBusy(false);
    }
  }

  async function setAgentToolPermission(
    tool: PublicTool,
    agentId: string,
    permission: PublicTool["permission"]
  ) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/tools/${tool.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permission, agent_id: agentId }),
      });
      const data = (await res.json().catch(() => null)) as {
        tools?: PublicTool[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Permission update failed (${res.status})`);
      }
      setTools(data?.tools ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Permission update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-500">
            <Link href="/sessions" className="hover:underline">
              Sessions
            </Link>
            {" / "}
            Settings
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Agent Fleet</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Registry, run metrics, and per-agent tool permissions.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/settings/analytics" className="text-neutral-600 hover:underline">
            Analytics
          </Link>
          <Link href="/settings/tools" className="text-neutral-600 hover:underline">
            Tools
          </Link>
          <Link href="/settings/memory" className="text-neutral-600 hover:underline">
            Memory
          </Link>
          <Link href="/settings/budget" className="text-neutral-600 hover:underline">
            Budget
          </Link>
          <Link href="/settings/policies" className="text-neutral-600 hover:underline">
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
        className="mb-10 space-y-3 border border-neutral-200 p-4"
      >
        <h2 className="text-sm font-medium">Register agent</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-neutral-600">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full border border-neutral-300 px-3 py-2"
              placeholder="Ops Copilot"
            />
          </label>
          <label className="block text-sm">
            <span className="text-neutral-600">Version</span>
            <input
              required
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="mt-1 w-full border border-neutral-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-neutral-600">Provider</span>
            <select
              value={modelProvider}
              onChange={(e) => setModelProvider(e.target.value)}
              className="mt-1 w-full border border-neutral-300 px-3 py-2"
            >
              <option value="anthropic">anthropic</option>
              <option value="openai">openai</option>
              <option value="google">google</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-neutral-600">Model id</span>
            <input
              required
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="mt-1 w-full border border-neutral-300 px-3 py-2"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-neutral-600">System prompt (optional)</span>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            className="mt-1 w-full border border-neutral-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Create agent"}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-neutral-500">Loading fleet…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500">No agents yet.</p>
      ) : (
        <ul className="space-y-4">
          {items.map(({ agent, metrics, owner }) => {
            const github = tools.find((t) => t.toolName === "github");
            const agentGithubPerm =
              github?.agentPermissions.find((p) => p.agentId === agent.id)
                ?.permission ?? null;
            return (
              <li
                key={agent.id}
                data-testid={`fleet-agent-${agent.id}`}
                className="border border-neutral-200 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">
                      {agent.name}{" "}
                      <span className="text-neutral-500">v{agent.version}</span>
                    </h3>
                    <p className="text-sm text-neutral-600">
                      {agent.modelProvider}/{agent.modelId} · status{" "}
                      {agent.status}
                    </p>
                    <p className="text-sm text-neutral-500">
                      Owner:{" "}
                      {owner?.name || owner?.email || owner?.id || "—"}
                    </p>
                  </div>
                  {agent.status === "active" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deactivate(agent.id)}
                      className="text-sm text-red-700 hover:underline disabled:opacity-60"
                    >
                      Deactivate
                    </button>
                  ) : null}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-neutral-500">Runs</dt>
                    <dd>{metrics.runCount}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Fail rate</dt>
                    <dd>{fmtPct(metrics.failRate)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Avg duration</dt>
                    <dd>{fmtDuration(metrics.avgDurationMs)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">Avg cost</dt>
                    <dd>{fmtCost(metrics.avgCostUsd)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-neutral-500">Last used</dt>
                    <dd>
                      {metrics.lastUsedAt
                        ? new Date(metrics.lastUsedAt).toLocaleString()
                        : "—"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-neutral-500">
                      Outcomes (ok / fail / escalated)
                    </dt>
                    <dd>
                      {metrics.successCount} / {metrics.failureCount} /{" "}
                      {metrics.escalatedCount}
                    </dd>
                  </div>
                </dl>

                {github ? (
                  <div className="mt-4 border-t border-neutral-100 pt-3">
                    <p className="mb-2 text-sm text-neutral-600">
                      GitHub tool for this agent (org default: {github.permission}
                      {agentGithubPerm
                        ? `; override: ${agentGithubPerm}`
                        : "; no override"}
                      )
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          "allowed",
                          "restricted",
                          "requires_checkpoint",
                        ] as const
                      ).map((perm) => (
                        <button
                          key={perm}
                          type="button"
                          disabled={busy || agent.status !== "active"}
                          onClick={() =>
                            void setAgentToolPermission(github, agent.id, perm)
                          }
                          className={`rounded border px-2 py-1 text-xs ${
                            agentGithubPerm === perm
                              ? "border-neutral-900 bg-neutral-900 text-white"
                              : "border-neutral-300 text-neutral-700"
                          } disabled:opacity-50`}
                        >
                          {perm}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
