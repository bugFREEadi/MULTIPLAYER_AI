/**
 * Step 23 verification harness — run with:
 *   npx tsx scripts/verify-step23.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const {
    agents,
    checkpointPolicies,
    sessionMembers,
    sessions,
    users,
  } = await import("../src/db/schema");
  const { createAgent, startAgentRun, completeAgentRun } = await import(
    "../src/lib/agents"
  );
  const {
    createCheckpointPolicy,
    maybeRaiseCheckpointForUserMessage,
    resolveCheckpoint,
  } = await import("../src/lib/checkpoints");
  const { appendSessionEvent } = await import("../src/lib/events");
  const {
    extractPlaybookFromSession,
    markSessionCompleted,
  } = await import("../src/lib/playbooks");
  const { listOrgPatterns, spinUpSessionFromPattern } = await import(
    "../src/lib/patterns"
  );

  const [user] = await db.select().from(users).limit(1);
  if (!user?.orgId) throw new Error("Need a user with orgId");
  const orgId = user.orgId;
  const suffix = Date.now().toString(36);

  const agent = await createAgent({
    orgId,
    name: `Playbook Agent ${suffix}`,
    version: "1.0.0",
    modelProvider: "anthropic",
    modelId: "claude-mock",
    systemPrompt: "playbook",
    ownerId: user.id,
  });

  const keyword = `playbook_kw_${suffix}`;
  const policy = await createCheckpointPolicy({
    orgId,
    name: `Playbook policy ${suffix}`,
    triggerType: "keyword",
    triggerConfig: { keyword },
    requiredRole: "owner",
    active: true,
  });

  const [session] = await db
    .insert(sessions)
    .values({
      orgId,
      title: `Playbook source ${suffix}`,
      status: "active",
      visibility: "internal_only",
      agentId: agent.id,
      createdBy: user.id,
    })
    .returning();
  await db.insert(sessionMembers).values({
    sessionId: session.id,
    userId: user.id,
    role: "owner",
  });

  const run = await startAgentRun(session.id);
  if (!run) throw new Error("Expected agent_run for bound agent");
  await completeAgentRun(run.id, "success");

  const userEvent = await appendSessionEvent({
    sessionId: session.id,
    eventType: "user_message",
    actorId: user.id,
    actorType: "human",
    payload: { content: `please ${keyword} now` },
  });
  const raised = await maybeRaiseCheckpointForUserMessage({
    sessionId: session.id,
    orgId,
    actorId: user.id,
    userMessageEvent: userEvent,
    content: `please ${keyword} now`,
  });
  if (!raised.checkpoint) throw new Error("Expected checkpoint to fire");

  await resolveCheckpoint({
    sessionId: session.id,
    checkpointEventId: raised.checkpoint.id,
    actorId: user.id,
    actorRole: "owner",
    decision: "reject",
  });

  await markSessionCompleted({ orgId, sessionId: session.id });
  console.log("session completed with agent + checkpoint");

  const { pattern, extraction } = await extractPlaybookFromSession({
    orgId,
    sessionId: session.id,
    actorId: user.id,
  });
  if (extraction !== "mechanical") {
    throw new Error(`Expected mechanical extraction in mock mode, got ${extraction}`);
  }
  if (pattern.createdFromSessionId !== session.id) {
    throw new Error("created_from_session_id not set");
  }

  const steps = pattern.steps as Array<{
    agent_id?: string | null;
    checkpoint_policy_id?: string | null;
  }>;
  const hasAgent = steps.some((s) => s.agent_id === agent.id);
  const hasPolicy = steps.some((s) => s.checkpoint_policy_id === policy.id);
  if (!hasAgent) throw new Error("Extracted steps missing bound agent");
  if (!hasPolicy) throw new Error("Extracted steps missing fired checkpoint policy");
  console.log("extracted playbook steps ok", steps.length);

  const listed = await listOrgPatterns(orgId);
  if (!listed.some((p) => p.id === pattern.id && p.createdFromSessionId)) {
    throw new Error("Extracted playbook missing from library list");
  }
  console.log("appears in pattern library ok");

  const { session: spun } = await spinUpSessionFromPattern({
    orgId,
    userId: user.id,
    patternId: pattern.id,
    title: `From playbook ${suffix}`,
  });
  if (spun.agentId !== agent.id) {
    throw new Error(`Spin-up agent mismatch: ${spun.agentId}`);
  }
  const attached = spun.attachedCheckpointPolicyIds;
  if (!Array.isArray(attached) || !attached.includes(policy.id)) {
    throw new Error(
      `Spin-up missing attached policy ${policy.id}: ${JSON.stringify(attached)}`
    );
  }
  console.log("spin-up from extracted playbook ok");

  // Soft cleanup
  await db
    .update(checkpointPolicies)
    .set({ active: false })
    .where(eq(checkpointPolicies.id, policy.id));
  await db.update(agents).set({ status: "archived" }).where(eq(agents.id, agent.id));

  console.log("\nSTEP 23 VERIFY OK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
