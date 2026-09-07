"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type BudgetStatus = {
  orgId: string;
  monthStart: string;
  spendUsd: number;
  spendUsdFormatted: string;
  monthlyLimitUsd: number | null;
  alertThresholdPct: number | null;
  spendPctOfLimit: number | null;
  alertActive: boolean;
  softLocked: boolean;
  hasLimit: boolean;
};

export default function BudgetClient() {
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limitInput, setLimitInput] = useState("1.00");
  const [thresholdInput, setThresholdInput] = useState("80");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/org/budget");
    const data = (await res.json().catch(() => null)) as {
      budget?: BudgetStatus;
      error?: string;
    } | null;
    if (!res.ok || !data?.budget) {
      setError(data?.error ?? `Failed to load (${res.status})`);
      setLoading(false);
      return;
    }
    setBudget(data.budget);
    if (data.budget.monthlyLimitUsd != null) {
      setLimitInput(String(data.budget.monthlyLimitUsd));
    }
    if (data.budget.alertThresholdPct != null) {
      setThresholdInput(String(data.budget.alertThresholdPct));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/org/budget", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          monthly_limit_usd: Number(limitInput),
          alert_threshold_pct: Number(thresholdInput),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        budget?: BudgetStatus;
        error?: string;
      } | null;
      if (!res.ok || !data?.budget) {
        throw new Error(data?.error ?? `Save failed (${res.status})`);
      }
      setBudget(data.budget);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/org/budget", { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        budget?: BudgetStatus;
        error?: string;
      } | null;
      if (!res.ok || !data?.budget) {
        throw new Error(data?.error ?? `Refresh failed (${res.status})`);
      }
      setBudget(data.budget);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const pct =
    budget?.spendPctOfLimit != null
      ? Math.min(100, Math.max(0, budget.spendPctOfLimit))
      : 0;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <header className="mb-8">
        <Link href="/sessions" className="text-sm text-neutral-500 hover:underline">
          ← Sessions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Budget & cost
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Org monthly spend vs limit. Soft-lock blocks new sessions and messages
          when the limit is crossed — in-progress sessions are not killed.
        </p>
      </header>

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading || !budget ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <section
          data-testid="budget-dashboard"
          className="mb-8 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                This month
              </p>
              <p className="mt-1 font-mono text-2xl tabular-nums text-neutral-900">
                ${budget.spendUsdFormatted}
                {budget.monthlyLimitUsd != null ? (
                  <span className="text-base text-neutral-500">
                    {" "}
                    / ${budget.monthlyLimitUsd.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-base text-neutral-500"> / no limit</span>
                )}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Month start (UTC): {budget.monthStart.slice(0, 10)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing || !budget.hasLimit}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs disabled:opacity-50"
            >
              {refreshing ? "Checking…" : "Run spend check"}
            </button>
          </div>

          {budget.hasLimit ? (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
                <div
                  data-testid="budget-progress"
                  className={`h-full ${
                    budget.softLocked
                      ? "bg-rose-600"
                      : budget.alertActive
                        ? "bg-amber-500"
                        : "bg-emerald-600"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-neutral-700">
                {budget.spendPctOfLimit?.toFixed(1)}% of limit
                {budget.alertThresholdPct != null
                  ? ` · alert at ${budget.alertThresholdPct}%`
                  : ""}
              </p>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {budget.alertActive ? (
              <span
                data-testid="budget-alert"
                className="rounded bg-amber-100 px-2 py-1 font-medium text-amber-900"
              >
                Alert active
              </span>
            ) : (
              <span className="rounded bg-neutral-200 px-2 py-1 text-neutral-700">
                No alert
              </span>
            )}
            {budget.softLocked ? (
              <span
                data-testid="budget-soft-lock"
                className="rounded bg-rose-100 px-2 py-1 font-medium text-rose-900"
              >
                Soft-locked
              </span>
            ) : (
              <span className="rounded bg-neutral-200 px-2 py-1 text-neutral-700">
                Not soft-locked
              </span>
            )}
          </div>
        </section>
      )}

      <form onSubmit={onSave} className="space-y-4 border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Set monthly limit
        </h2>
        <label className="block text-sm">
          Monthly limit (USD)
          <input
            type="number"
            step="0.000001"
            min="0.000001"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
            required
          />
        </label>
        <label className="block text-sm">
          Alert threshold (%)
          <input
            type="number"
            min={1}
            max={100}
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
            required
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save budget"}
        </button>
      </form>
    </main>
  );
}
