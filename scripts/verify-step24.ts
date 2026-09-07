/**
 * Step 24 verification harness — run with:
 *   npx tsx -r ./scripts/shim-server-only.cjs scripts/verify-step24.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { and, eq, gte, sql, sum } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const {
    agents,
    checkpointPolicies,
    sessionEvents,
    sessionMembers,
    sessions,
    users,
  } = await import("../src/db/schema");
  const { createAgent, startAgentRun, completeAgentRun } = await import(
    "../src/lib/agents"
  );
  const { getOrgAnalytics } = await import("../src/lib/analytics");
  const {
    createCheckpointPolicy,
    maybeRaiseCheckpointForUserMessage,
    resolveCheckpoint,
  } = await import("../src/lib/checkpoints");
  const { appendSessionEvent } = await import("../src/lib/events");
  const { takeSessionControl } = await import("../src/lib/sessions");

  const [user] = await db.select().from(users).limit(1);
  if (!user?.orgId) throw new Error("Need a user with orgId");
  const orgId = user.orgId;
  const suffix = Date.now().toString(36);
  const now = new Date();

  // --- Seed activity ---
  const agentA = await createAgent({
    orgId,
    name: `Analytics A ${suffix}`,
    version: "1.0.0",
    modelProvider: "anthropic",
    modelId: "claude-mock",
    systemPrompt: "a",
    ownerId: user.id,
  });
  const agentB = await createAgent({
    orgId,
    name: `Analytics B ${suffix}`,
    version: "1.0.0",
    modelProvider: "anthropic",
    modelId: "claude-mock",
    systemPrompt: "b",
    ownerId: user.id,
  });

  const keyword = `analytics_kw_${suffix}`;
  const policy = await createCheckpointPolicy({
    orgId,
    name: `Analytics policy ${suffix}`,
    triggerType: "keyword",
    triggerConfig: { keyword },
    requiredRole: "owner",
    active: true,
  });

  async function makeSession(title: string, agentId: string) {
    const [session] = await db
      .insert(sessions)
      .values({
        orgId,
        title,
        status: "active",
        visibility: "internal_only",
        agentId,
        createdBy: user.id,
      })
      .returning();
    await db.insert(sessionMembers).values({
      sessionId: session.id,
      userId: user.id,
      role: "owner",
    });
    return session;
  }

  const s1 = await makeSession(`Analytics s1 ${suffix}`, agentA.id);
  const s2 = await makeSession(`Analytics s2 ${suffix}`, agentB.id);
  const s3 = await makeSession(`Analytics s3 ${suffix}`, agentA.id);

  // Costs on different sessions/agents
  await appendSessionEvent({
    sessionId: s1.id,
    eventType: "agent_message",
    actorId: null,
    actorType: "agent",
    payload: { content: "[MOCK] a" },
    costUsd: "0.010000",
  });
  await appendSessionEvent({
    sessionId: s2.id,
    eventType: "agent_message",
    actorId: null,
    actorType: "agent",
    payload: { content: "[MOCK] b" },
    costUsd: "0.020000",
  });
  await appendSessionEvent({
    sessionId: s3.id,
    eventType: "agent_message",
    actorId: null,
    actorType: "agent",
    payload: { content: "[MOCK] a2" },
    costUsd: "0.005000",
  });

  const run1 = await startAgentRun(s1.id);
  if (run1) await completeAgentRun(run1.id, "success");
  const run2 = await startAgentRun(s2.id);
  if (run2) await completeAgentRun(run2.id, "success");

  // Checkpoints: 2 approve, 1 reject
  async function fireAndResolve(
    sessionId: string,
    decision: "approve" | "reject"
  ) {
    const msg = await appendSessionEvent({
      sessionId,
      eventType: "user_message",
      actorId: user.id,
      actorType: "human",
      payload: { content: `please ${keyword}` },
    });
    const raised = await maybeRaiseCheckpointForUserMessage({
      sessionId,
      orgId,
      actorId: user.id,
      userMessageEvent: msg,
      content: `please ${keyword}`,
    });
    if (!raised.checkpoint) throw new Error("Expected checkpoint");
    await resolveCheckpoint({
      sessionId,
      checkpointEventId: raised.checkpoint.id,
      actorId: user.id,
      actorRole: "owner",
      decision,
    });
  }

  await fireAndResolve(s1.id, "approve");
  await fireAndResolve(s2.id, "approve");
  await fireAndResolve(s3.id, "reject");

  // Take-control on s1 (owner taking control is a no-op of roles but still emits)
  // Need a second member as pilot first for a meaningful take-control — emit via takeSessionControl
  // Insert a second user as pilot if possible, or just call takeSessionControl as owner.
  await takeSessionControl({ sessionId: s1.id, actor: user });

  console.log("seeded sessions/checkpoints/costs/take-control");

  // --- Analytics ---
  const analytics = await getOrgAnalytics(orgId, { days: 7, now });

  // Manual session volume (created in window)
  const since = new Date(analytics.period.since);
  const manualSessions = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.orgId, orgId), gte(sessions.createdAt, since)));
  if (analytics.sessionVolume.total !== manualSessions.length) {
    throw new Error(
      `Session volume mismatch: analytics=${analytics.sessionVolume.total} manual=${manualSessions.length}`
    );
  }
  // Our 3 new sessions should be included
  const seededIds = new Set([s1.id, s2.id, s3.id]);
  const foundSeeded = manualSessions.filter((s) => seededIds.has(s.id));
  if (foundSeeded.length !== 3) {
    throw new Error("Expected 3 seeded sessions in window");
  }
  console.log("session volume matches manual count", analytics.sessionVolume.total);

  // Manual checkpoint resolutions
  const resolved = await db
    .select()
    .from(sessionEvents)
    .innerJoin(sessions, eq(sessionEvents.sessionId, sessions.id))
    .where(
      and(
        eq(sessions.orgId, orgId),
        eq(sessionEvents.eventType, "checkpoint_resolved"),
        gte(sessionEvents.createdAt, since)
      )
    );
  let manApproved = 0;
  let manRejected = 0;
  let policyApproved = 0;
  let policyRejected = 0;
  for (const row of resolved) {
    const p = row.session_events.payload as Record<string, unknown>;
    if (p.decision === "approve") {
      manApproved += 1;
      if (p.policy_id === policy.id) policyApproved += 1;
    }
    if (p.decision === "reject") {
      manRejected += 1;
      if (p.policy_id === policy.id) policyRejected += 1;
    }
  }
  if (
    analytics.checkpoints.approved !== manApproved ||
    analytics.checkpoints.rejected !== manRejected
  ) {
    throw new Error(
      `Checkpoint totals mismatch: ${JSON.stringify(analytics.checkpoints)} vs ${manApproved}/${manRejected}`
    );
  }
  const policyStat = analytics.checkpoints.byPolicy.find(
    (p) => p.policyId === policy.id
  );
  if (
    !policyStat ||
    policyStat.approved !== policyApproved ||
    policyStat.rejected !== policyRejected
  ) {
    throw new Error(`Per-policy stats mismatch: ${JSON.stringify(policyStat)}`);
  }
  const expectedRate = manApproved / (manApproved + manRejected);
  if (
    analytics.checkpoints.approvalRate == null ||
    Math.abs(analytics.checkpoints.approvalRate - expectedRate) > 1e-9
  ) {
    throw new Error("Approval rate mismatch");
  }
  console.log(
    "checkpoint rates match",
    analytics.checkpoints.approvalRate,
    "policy",
    policyStat.approvalRate
  );

  // Manual take-control
  const takeControls = await db
    .select()
    .from(sessionEvents)
    .innerJoin(sessions, eq(sessionEvents.sessionId, sessions.id))
    .where(
      and(
        eq(sessions.orgId, orgId),
        eq(sessionEvents.eventType, "role_change"),
        gte(sessionEvents.createdAt, since)
      )
    );
  let manTake = 0;
  for (const row of takeControls) {
    const p = row.session_events.payload as Record<string, unknown>;
    if (p.action === "take_control") manTake += 1;
  }
  if (analytics.interventions.takeControlCount !== manTake) {
    throw new Error(
      `Take-control mismatch: ${analytics.interventions.takeControlCount} vs ${manTake}`
    );
  }
  if (manTake < 1) throw new Error("Expected ≥1 take-control event");
  console.log("take-control count matches", manTake);

  // Manual cost sum in window
  const [costRow] = await db
    .select({ total: sum(sessionEvents.costUsd) })
    .from(sessionEvents)
    .innerJoin(sessions, eq(sessionEvents.sessionId, sessions.id))
    .where(
      and(eq(sessions.orgId, orgId), gte(sessionEvents.createdAt, since))
    );
  const manualCost = Number(costRow?.total ?? 0);
  if (Math.abs(analytics.costs.totalUsd - manualCost) > 1e-6) {
    throw new Error(
      `Cost total mismatch: ${analytics.costs.totalUsd} vs ${manualCost}`
    );
  }
  // Seeded costs should appear in per-session
  const s1Cost = analytics.costs.perSession.find((s) => s.sessionId === s1.id);
  const s2Cost = analytics.costs.perSession.find((s) => s.sessionId === s2.id);
  if (!s1Cost || Math.abs(s1Cost.costUsd - 0.01) > 1e-6) {
    throw new Error(`s1 cost wrong: ${JSON.stringify(s1Cost)}`);
  }
  if (!s2Cost || Math.abs(s2Cost.costUsd - 0.02) > 1e-6) {
    throw new Error(`s2 cost wrong: ${JSON.stringify(s2Cost)}`);
  }
  const agentARow = analytics.costs.perAgent.find((a) => a.agentId === agentA.id);
  const agentBRow = analytics.costs.perAgent.find((a) => a.agentId === agentB.id);
  if (!agentARow || agentARow.runCount < 1) {
    throw new Error("Agent A metrics missing from analytics");
  }
  if (!agentBRow || agentBRow.runCount < 1) {
    throw new Error("Agent B metrics missing from analytics");
  }
  console.log("costs match manual sum", analytics.costs.totalUsd);

  // Refresh: add another session + cost, re-query
  const s4 = await makeSession(`Analytics s4 ${suffix}`, agentB.id);
  await appendSessionEvent({
    sessionId: s4.id,
    eventType: "agent_message",
    actorId: null,
    actorType: "agent",
    payload: { content: "[MOCK] refresh" },
    costUsd: "0.003000",
  });
  const after = await getOrgAnalytics(orgId, { days: 7, now: new Date() });
  if (after.sessionVolume.total !== analytics.sessionVolume.total + 1) {
    throw new Error(
      `Refresh volume: expected ${analytics.sessionVolume.total + 1}, got ${after.sessionVolume.total}`
    );
  }
  if (Math.abs(after.costs.totalUsd - (analytics.costs.totalUsd + 0.003)) > 1e-6) {
    throw new Error(
      `Refresh cost: expected ${analytics.costs.totalUsd + 0.003}, got ${after.costs.totalUsd}`
    );
  }
  console.log("refresh reflects new activity ok");

  // Soft cleanup
  await db
    .update(checkpointPolicies)
    .set({ active: false })
    .where(eq(checkpointPolicies.id, policy.id));
  await db.update(agents).set({ status: "archived" }).where(eq(agents.id, agentA.id));
  await db.update(agents).set({ status: "archived" }).where(eq(agents.id, agentB.id));
  void sql;

  console.log("\nSTEP 24 VERIFY OK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
