import { runScheduledHandoffs } from "@/lib/handoff";
import { evaluateAllOrgBudgets } from "@/lib/budget";
import { runScheduledMemoryExtraction } from "@/lib/memory";
import { advanceTaskGraph } from "@/lib/manager-agent";
import { inngest } from "@/inngest/client";

/**
 * Light schedule wire for Feature 1.5 — every 3 hours.
 * Deep observation against long-running sessions is deferred; on-demand
 * POST /api/sessions/:id/handoff is the primary verification path.
 */
export const scheduledHandoffs = inngest.createFunction(
  {
    id: "scheduled-handoffs",
    triggers: [{ cron: "0 */3 * * *" }],
  },
  async () => {
    return runScheduledHandoffs();
  }
);

/**
 * Feature 1.8 — check org monthly spend vs budget_limits.
 * Soft-lock is also enforced live on new session/message writes; this job
 * persists alert_active / soft_locked flags for the dashboard.
 */
export const scheduledBudgetChecks = inngest.createFunction(
  {
    id: "scheduled-budget-checks",
    triggers: [{ cron: "0 * * * *" }],
  },
  async () => {
    return evaluateAllOrgBudgets();
  }
);

/**
 * Feature 2.1 — periodic memory extraction on active sessions.
 * On-demand POST /api/sessions/:id/memory is the primary verification path.
 */
export const scheduledMemoryExtraction = inngest.createFunction(
  {
    id: "scheduled-memory-extraction",
    triggers: [{ cron: "15 * * * *" }],
  },
  async () => {
    return runScheduledMemoryExtraction();
  }
);

/**
 * Feature 2.3 — advance task graph after a node completes.
 * Sync completeTaskNode already advances; this Inngest path is the durable
 * retry / fan-in hook (idempotent). Temporal migration deferred.
 */
export const managerNodeCompleted = inngest.createFunction(
  {
    id: "manager-node-completed",
    triggers: [{ event: "manager/node.completed" }],
  },
  async ({ event }) => {
    const taskGraphId = event.data?.taskGraphId as string | undefined;
    if (!taskGraphId) {
      return { skipped: true, reason: "missing taskGraphId" };
    }
    return advanceTaskGraph(taskGraphId);
  }
);
