import "server-only";

import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  checkpointPolicies,
  sessionEvents,
  sessions,
} from "@/db/schema";
import { listAgentsWithMetrics } from "@/lib/agents";

export type AnalyticsPeriod = {
  since: string;
  until: string;
  days: number;
};

export type SessionVolumePoint = {
  day: string;
  count: number;
};

export type CheckpointPolicyStats = {
  policyId: string | null;
  policyName: string | null;
  approved: number;
  rejected: number;
  total: number;
  approvalRate: number | null;
};

export type SessionCostRow = {
  sessionId: string;
  title: string | null;
  costUsd: number;
  createdAt: string | null;
};

export type OrgAnalytics = {
  period: AnalyticsPeriod;
  sessionVolume: {
    total: number;
    byDay: SessionVolumePoint[];
  };
  checkpoints: {
    approved: number;
    rejected: number;
    total: number;
    approvalRate: number | null;
    byPolicy: CheckpointPolicyStats[];
  };
  interventions: {
    takeControlCount: number;
  };
  costs: {
    totalUsd: number;
    perSession: SessionCostRow[];
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

function parseUsd(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rate(approved: number, total: number): number | null {
  if (total === 0) return null;
  return approved / total;
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function dayKey(d: Date): string {
  return startOfUtcDay(d).toISOString().slice(0, 10);
}

export function resolveAnalyticsWindow(opts?: {
  days?: number;
  now?: Date;
}): { since: Date; until: Date; days: number } {
  const days =
    opts?.days != null && Number.isFinite(opts.days) && opts.days > 0
      ? Math.min(Math.floor(opts.days), 365)
      : 30;
  const until = opts?.now ?? new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  return { since, until, days };
}

/**
 * Org analytics — aggregation over existing session_events / agent_runs /
 * checkpoint resolutions. No new tables.
 */
export async function getOrgAnalytics(
  orgId: string,
  opts?: { days?: number; now?: Date }
): Promise<OrgAnalytics> {
  const { since, until, days } = resolveAnalyticsWindow(opts);

  const orgSessions = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.orgId, orgId),
        gte(sessions.createdAt, since)
      )
    )
    .orderBy(asc(sessions.createdAt));

  const sessionIds = orgSessions.map((s) => s.id);

  // Session volume by day
  const byDayMap = new Map<string, number>();
  for (let i = 0; i <= days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    if (d > until) break;
    byDayMap.set(dayKey(d), 0);
  }
  for (const s of orgSessions) {
    if (!s.createdAt) continue;
    const key = dayKey(s.createdAt);
    byDayMap.set(key, (byDayMap.get(key) ?? 0) + 1);
  }
  const byDay: SessionVolumePoint[] = [...byDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));

  // Events in window for org sessions (also include events on older sessions
  // that happened in-window — join via sessions.orgId)
  const eventRows =
    sessionIds.length === 0
      ? []
      : await db
          .select({
            id: sessionEvents.id,
            sessionId: sessionEvents.sessionId,
            eventType: sessionEvents.eventType,
            payload: sessionEvents.payload,
            costUsd: sessionEvents.costUsd,
            createdAt: sessionEvents.createdAt,
          })
          .from(sessionEvents)
          .innerJoin(sessions, eq(sessionEvents.sessionId, sessions.id))
          .where(
            and(
              eq(sessions.orgId, orgId),
              gte(sessionEvents.createdAt, since)
            )
          );

  let approved = 0;
  let rejected = 0;
  const perPolicy = new Map<
    string,
    { approved: number; rejected: number; name: string | null }
  >();
  let takeControlCount = 0;

  for (const event of eventRows) {
    const payload =
      event.payload &&
      typeof event.payload === "object" &&
      !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : {};

    if (event.eventType === "checkpoint_resolved") {
      const decision =
        typeof payload.decision === "string" ? payload.decision : null;
      const policyId =
        typeof payload.policy_id === "string" ? payload.policy_id : null;
      const key = policyId ?? "__none__";
      const bucket = perPolicy.get(key) ?? {
        approved: 0,
        rejected: 0,
        name: null,
      };
      if (decision === "approve") {
        approved += 1;
        bucket.approved += 1;
      } else if (decision === "reject") {
        rejected += 1;
        bucket.rejected += 1;
      }
      perPolicy.set(key, bucket);
    }

    if (
      event.eventType === "role_change" &&
      payload.action === "take_control"
    ) {
      takeControlCount += 1;
    }
  }

  const policyIds = [...perPolicy.keys()].filter((id) => id !== "__none__");
  const policyRows =
    policyIds.length === 0
      ? []
      : await db
          .select({
            id: checkpointPolicies.id,
            name: checkpointPolicies.name,
          })
          .from(checkpointPolicies)
          .where(inArray(checkpointPolicies.id, policyIds));
  const policyNameById = new Map(policyRows.map((p) => [p.id, p.name]));

  const byPolicy: CheckpointPolicyStats[] = [...perPolicy.entries()]
    .map(([policyId, stats]) => {
      const id = policyId === "__none__" ? null : policyId;
      const total = stats.approved + stats.rejected;
      return {
        policyId: id,
        policyName: id ? (policyNameById.get(id) ?? null) : null,
        approved: stats.approved,
        rejected: stats.rejected,
        total,
        approvalRate: rate(stats.approved, total),
      };
    })
    .sort((a, b) => b.total - a.total);

  // Cost per session (all-time cost for sessions created in window,
  // plus any session that had spend in window — use events in window sum
  // per session for period-accurate cost)
  const costBySession = new Map<string, number>();
  for (const event of eventRows) {
    const c = parseUsd(event.costUsd);
    if (c === 0) continue;
    costBySession.set(
      event.sessionId,
      (costBySession.get(event.sessionId) ?? 0) + c
    );
  }

  // Also include sessions created in window with zero spend
  for (const s of orgSessions) {
    if (!costBySession.has(s.id)) costBySession.set(s.id, 0);
  }

  const sessionMeta = new Map(
    orgSessions.map((s) => [
      s.id,
      {
        title: s.title,
        createdAt: s.createdAt ? s.createdAt.toISOString() : null,
      },
    ])
  );

  // Titles for sessions that only appear via in-window events
  const missingMeta = [...costBySession.keys()].filter(
    (id) => !sessionMeta.has(id)
  );
  if (missingMeta.length > 0) {
    const extras = await db
      .select({
        id: sessions.id,
        title: sessions.title,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(inArray(sessions.id, missingMeta));
    for (const s of extras) {
      sessionMeta.set(s.id, {
        title: s.title,
        createdAt: s.createdAt ? s.createdAt.toISOString() : null,
      });
    }
  }

  const perSession: SessionCostRow[] = [...costBySession.entries()]
    .map(([sessionId, costUsd]) => {
      const meta = sessionMeta.get(sessionId);
      return {
        sessionId,
        title: meta?.title ?? null,
        costUsd,
        createdAt: meta?.createdAt ?? null,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  const totalUsd = perSession.reduce((acc, row) => acc + row.costUsd, 0);

  // Per-agent: reuse Step 17 metrics (re-surface, don't reinvent)
  const agentRows = await listAgentsWithMetrics(orgId);
  const perAgent = agentRows.map((row) => ({
    agentId: row.agent.id,
    name: row.agent.name,
    version: row.agent.version,
    runCount: row.metrics.runCount,
    avgCostUsd: row.metrics.avgCostUsd,
    failRate: row.metrics.failRate,
  }));

  const checkpointTotal = approved + rejected;

  return {
    period: {
      since: since.toISOString(),
      until: until.toISOString(),
      days,
    },
    sessionVolume: {
      total: orgSessions.length,
      byDay,
    },
    checkpoints: {
      approved,
      rejected,
      total: checkpointTotal,
      approvalRate: rate(approved, checkpointTotal),
      byPolicy,
    },
    interventions: {
      takeControlCount,
    },
    costs: {
      totalUsd,
      perSession,
      perAgent,
    },
  };
}
