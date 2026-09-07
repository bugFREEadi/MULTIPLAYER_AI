"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Analytics = {
  period: { since: string; until: string; days: number };
  sessionVolume: {
    total: number;
    byDay: Array<{ day: string; count: number }>;
  };
  checkpoints: {
    approved: number;
    rejected: number;
    total: number;
    approvalRate: number | null;
    byPolicy: Array<{
      policyId: string | null;
      policyName: string | null;
      approved: number;
      rejected: number;
      total: number;
      approvalRate: number | null;
    }>;
  };
  interventions: { takeControlCount: number };
  costs: {
    totalUsd: number;
    perSession: Array<{
      sessionId: string;
      title: string | null;
      costUsd: number;
      createdAt: string | null;
    }>;
    perAgent: Array<{
      agentId: string;
      name: string;
      version: string;
      runCount: number;
      avgCostUsd: number;
      failRate: number;
    }>;
  };
};

function pct(rate: number | null): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(0)}%`;
}

function usd(n: number): string {
  if (n > 0 && n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function VolumeBars({
  points,
}: {
  points: Array<{ day: string; count: number }>;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const recent = points.slice(-14);
  return (
    <div
      className="mt-3 flex h-28 items-end gap-1"
      data-testid="session-volume-chart"
    >
      {recent.map((p) => (
        <div key={p.day} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full min-h-[2px] rounded-t bg-neutral-800"
            style={{ height: `${(p.count / max) * 100}%` }}
            title={`${p.day}: ${p.count}`}
          />
          <span className="text-[9px] text-neutral-400">
            {p.day.slice(5)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsClient() {
  const [days, setDays] = useState(30);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/org/analytics?days=${days}`);
    const data = (await res.json().catch(() => null)) as {
      analytics?: Analytics;
      error?: string;
    } | null;
    if (!res.ok || !data?.analytics) {
      setError(data?.error ?? `Failed to load (${res.status})`);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setAnalytics(data.analytics);
    setLoading(false);
    setRefreshing(false);
  }, [days]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">
            Session intelligence
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Aggregations over sessions, checkpoints, take-control, and cost —
            no new tables.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
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
            href="/settings/budget"
            className="text-neutral-600 hover:underline"
          >
            Budget
          </Link>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-sm text-neutral-700">
          Window
          <select
            data-testid="analytics-days"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="ml-2 border border-neutral-300 bg-white px-2 py-1 text-sm"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="analytics-refresh"
          disabled={refreshing || loading}
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading || !analytics ? (
        <p className="text-sm text-neutral-500">Loading analytics…</p>
      ) : (
        <div className="space-y-6" data-testid="analytics-dashboard">
          <section className="rounded-md border border-neutral-200 bg-white px-4 py-4">
            <h2 className="text-sm font-semibold text-neutral-900">
              Session volume
            </h2>
            <p
              className="mt-1 text-2xl font-semibold tabular-nums"
              data-testid="analytics-session-total"
            >
              {analytics.sessionVolume.total}
            </p>
            <p className="text-xs text-neutral-500">
              Sessions created in last {analytics.period.days} days
            </p>
            <VolumeBars points={analytics.sessionVolume.byDay} />
          </section>

          <section className="rounded-md border border-neutral-200 bg-white px-4 py-4">
            <h2 className="text-sm font-semibold text-neutral-900">
              Checkpoint approval rate
            </h2>
            <div className="mt-2 flex flex-wrap gap-6">
              <div>
                <p
                  className="text-2xl font-semibold tabular-nums"
                  data-testid="analytics-approval-rate"
                >
                  {pct(analytics.checkpoints.approvalRate)}
                </p>
                <p className="text-xs text-neutral-500">
                  {analytics.checkpoints.approved} approved ·{" "}
                  {analytics.checkpoints.rejected} rejected
                </p>
              </div>
            </div>
            {analytics.checkpoints.byPolicy.length > 0 ? (
              <table className="mt-3 w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                    <th className="py-1 font-medium">Policy</th>
                    <th className="py-1 font-medium">Approved</th>
                    <th className="py-1 font-medium">Rejected</th>
                    <th className="py-1 font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody data-testid="analytics-checkpoint-policies">
                  {analytics.checkpoints.byPolicy.map((row) => (
                    <tr
                      key={row.policyId ?? "none"}
                      className="border-b border-neutral-100"
                    >
                      <td className="py-1.5">
                        {row.policyName ?? "Unknown policy"}
                      </td>
                      <td className="py-1.5 tabular-nums">{row.approved}</td>
                      <td className="py-1.5 tabular-nums">{row.rejected}</td>
                      <td className="py-1.5 tabular-nums">
                        {pct(row.approvalRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-sm text-neutral-500">
                No checkpoint resolutions in this window.
              </p>
            )}
          </section>

          <section className="rounded-md border border-neutral-200 bg-white px-4 py-4">
            <h2 className="text-sm font-semibold text-neutral-900">
              Intervention frequency
            </h2>
            <p
              className="mt-1 text-2xl font-semibold tabular-nums"
              data-testid="analytics-take-control"
            >
              {analytics.interventions.takeControlCount}
            </p>
            <p className="text-xs text-neutral-500">
              Take-control events (Step 9) in window
            </p>
          </section>

          <section className="rounded-md border border-neutral-200 bg-white px-4 py-4">
            <h2 className="text-sm font-semibold text-neutral-900">
              Cost
            </h2>
            <p
              className="mt-1 text-2xl font-semibold tabular-nums"
              data-testid="analytics-cost-total"
            >
              {usd(analytics.costs.totalUsd)}
            </p>
            <p className="text-xs text-neutral-500">
              Event cost_usd in window
            </p>

            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Per agent (Step 17 metrics)
            </h3>
            {analytics.costs.perAgent.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-500">No agents yet.</p>
            ) : (
              <table className="mt-2 w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                    <th className="py-1 font-medium">Agent</th>
                    <th className="py-1 font-medium">Runs</th>
                    <th className="py-1 font-medium">Avg cost</th>
                    <th className="py-1 font-medium">Fail rate</th>
                  </tr>
                </thead>
                <tbody data-testid="analytics-agent-costs">
                  {analytics.costs.perAgent.map((a) => (
                    <tr
                      key={a.agentId}
                      className="border-b border-neutral-100"
                    >
                      <td className="py-1.5">
                        {a.name} v{a.version}
                      </td>
                      <td className="py-1.5 tabular-nums">{a.runCount}</td>
                      <td className="py-1.5 tabular-nums">
                        {usd(a.avgCostUsd)}
                      </td>
                      <td className="py-1.5 tabular-nums">
                        {pct(a.failRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Per session (window spend)
            </h3>
            {analytics.costs.perSession.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-500">No sessions.</p>
            ) : (
              <ul
                className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm"
                data-testid="analytics-session-costs"
              >
                {analytics.costs.perSession.slice(0, 20).map((s) => (
                  <li
                    key={s.sessionId}
                    className="flex justify-between gap-2 border-b border-neutral-50 py-1"
                  >
                    <Link
                      href={`/sessions/${s.sessionId}`}
                      className="truncate underline"
                    >
                      {s.title?.trim() || s.sessionId.slice(0, 8)}
                    </Link>
                    <span className="shrink-0 tabular-nums text-neutral-700">
                      {usd(s.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
