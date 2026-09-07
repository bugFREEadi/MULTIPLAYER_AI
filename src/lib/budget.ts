import { and, eq, gte, sum } from "drizzle-orm";
import { db } from "@/db";
import { budgetLimits, sessionEvents, sessions } from "@/db/schema";
import { AuthError } from "@/lib/auth-error";

export type BudgetLimitRow = typeof budgetLimits.$inferSelect;

function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function parseUsd(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Sum cost_usd for a single session (all time). */
export async function getSessionCostTotal(sessionId: string): Promise<{
  sessionId: string;
  costUsd: number;
  costUsdFormatted: string;
}> {
  const [row] = await db
    .select({
      total: sum(sessionEvents.costUsd),
    })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId));

  const costUsd = parseUsd(row?.total);
  return {
    sessionId,
    costUsd,
    costUsdFormatted: costUsd.toFixed(6),
  };
}

/** Org spend across all sessions in the current UTC calendar month. */
export async function getOrgMonthlySpend(orgId: string, now = new Date()) {
  const monthStart = startOfUtcMonth(now);
  const [row] = await db
    .select({
      total: sum(sessionEvents.costUsd),
    })
    .from(sessionEvents)
    .innerJoin(sessions, eq(sessionEvents.sessionId, sessions.id))
    .where(
      and(
        eq(sessions.orgId, orgId),
        gte(sessionEvents.createdAt, monthStart)
      )
    );

  const spendUsd = parseUsd(row?.total);
  return {
    orgId,
    monthStart: monthStart.toISOString(),
    spendUsd,
    spendUsdFormatted: spendUsd.toFixed(6),
  };
}

export async function getBudgetLimit(orgId: string): Promise<BudgetLimitRow | null> {
  const [row] = await db
    .select()
    .from(budgetLimits)
    .where(eq(budgetLimits.orgId, orgId))
    .limit(1);
  return row ?? null;
}

export async function upsertBudgetLimit(input: {
  orgId: string;
  monthlyLimitUsd: string | number;
  alertThresholdPct?: number;
}): Promise<BudgetLimitRow> {
  const monthly = Number(input.monthlyLimitUsd);
  if (!Number.isFinite(monthly) || monthly <= 0) {
    throw new AuthError("monthly_limit_usd must be a positive number", 400);
  }
  const threshold =
    input.alertThresholdPct == null ? 80 : Number(input.alertThresholdPct);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    throw new AuthError(
      "alert_threshold_pct must be an integer from 1 to 100",
      400
    );
  }

  const [row] = await db
    .insert(budgetLimits)
    .values({
      orgId: input.orgId,
      monthlyLimitUsd: monthly.toFixed(6),
      alertThresholdPct: threshold,
      softLocked: false,
      alertActive: false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: budgetLimits.orgId,
      set: {
        monthlyLimitUsd: monthly.toFixed(6),
        alertThresholdPct: threshold,
        // Re-evaluate immediately after limit change.
        softLocked: false,
        alertActive: false,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Apply current spend against the new limit right away.
  return evaluateOrgBudget(input.orgId);
}

export type OrgBudgetStatus = {
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

export async function getOrgBudgetStatus(orgId: string): Promise<OrgBudgetStatus> {
  const [{ spendUsd, monthStart }, limit] = await Promise.all([
    getOrgMonthlySpend(orgId),
    getBudgetLimit(orgId),
  ]);

  if (!limit) {
    return {
      orgId,
      monthStart,
      spendUsd,
      spendUsdFormatted: spendUsd.toFixed(6),
      monthlyLimitUsd: null,
      alertThresholdPct: null,
      spendPctOfLimit: null,
      alertActive: false,
      softLocked: false,
      hasLimit: false,
    };
  }

  const monthlyLimitUsd = parseUsd(limit.monthlyLimitUsd);
  const spendPctOfLimit =
    monthlyLimitUsd > 0 ? (spendUsd / monthlyLimitUsd) * 100 : 0;
  const softLocked = spendUsd >= monthlyLimitUsd;
  const alertActive =
    softLocked || spendPctOfLimit >= limit.alertThresholdPct;

  return {
    orgId,
    monthStart,
    spendUsd,
    spendUsdFormatted: spendUsd.toFixed(6),
    monthlyLimitUsd,
    alertThresholdPct: limit.alertThresholdPct,
    spendPctOfLimit,
    alertActive,
    softLocked,
    hasLimit: true,
  };
}

/**
 * Persist soft_locked / alert_active from live spend. Used by the cron job
 * and after budget upserts. Does not interrupt in-progress sessions.
 */
export async function evaluateOrgBudget(orgId: string): Promise<BudgetLimitRow> {
  const limit = await getBudgetLimit(orgId);
  if (!limit) {
    throw new AuthError("No budget limit configured for this org", 404);
  }

  const status = await getOrgBudgetStatus(orgId);
  const [updated] = await db
    .update(budgetLimits)
    .set({
      softLocked: status.softLocked,
      alertActive: status.alertActive,
      updatedAt: new Date(),
    })
    .where(eq(budgetLimits.orgId, orgId))
    .returning();

  if (status.alertActive) {
    console.warn(
      "[budget alert]",
      orgId,
      `spend=${status.spendUsdFormatted}`,
      `limit=${status.monthlyLimitUsd}`,
      `pct=${status.spendPctOfLimit?.toFixed(1)}`,
      status.softLocked ? "SOFT_LOCKED" : "ALERT"
    );
  }

  return updated;
}

export async function evaluateAllOrgBudgets(): Promise<{
  checked: number;
  alerted: number;
  softLocked: number;
}> {
  const rows = await db.select({ orgId: budgetLimits.orgId }).from(budgetLimits);
  let alerted = 0;
  let softLocked = 0;

  for (const row of rows) {
    const updated = await evaluateOrgBudget(row.orgId);
    if (updated.alertActive) alerted += 1;
    if (updated.softLocked) softLocked += 1;
  }

  return { checked: rows.length, alerted, softLocked };
}

/**
 * Soft-lock: block NEW sessions / turn-producing messages only.
 * Existing sessions stay alive; in-flight work is not cancelled.
 */
export async function assertOrgBudgetAllowsNewWork(orgId: string | null) {
  if (!orgId) return;
  const status = await getOrgBudgetStatus(orgId);
  if (!status.hasLimit) return;
  if (status.softLocked) {
    const limitLabel =
      status.monthlyLimitUsd != null && status.monthlyLimitUsd < 0.01
        ? status.monthlyLimitUsd.toFixed(6)
        : status.monthlyLimitUsd?.toFixed(2);
    throw new AuthError(
      `Organization monthly budget of $${limitLabel} has been reached (spent $${status.spendUsdFormatted}). New sessions and messages are soft-locked until next month or the limit is raised.`,
      402
    );
  }
}
