/**
 * Step 22 verification harness — run with:
 *   npx tsx scripts/verify-step22.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { and, eq } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const {
    agents,
    checkpointPolicies,
    sessions,
    users,
    workflowPatterns,
  } = await import("../src/db/schema");
  const { createAgent } = await import("../src/lib/agents");
  const { createCheckpointPolicy, maybeRaiseCheckpointForUserMessage } =
    await import("../src/lib/checkpoints");
  const { appendSessionEvent, listSessionEvents } = await import(
    "../src/lib/events"
  );
  const {
    createPattern,
    listOrgPatterns,
    spinUpSessionFromPattern,
  } = await import("../src/lib/patterns");

  const [user] = await db.select().from(users).limit(1);
  if (!user?.orgId) throw new Error("Need a user with orgId");
  const orgId = user.orgId;

  const suffix = Date.now().toString(36);

  const agentX = await createAgent({
    orgId,
    name: `Pattern Agent X ${suffix}`,
    version: "1.0.0",
    modelProvider: "anthropic",
    modelId: "claude-mock",
    systemPrompt: "x",
    ownerId: user.id,
  });
  const agentY = await createAgent({
    orgId,
    name: `Pattern Agent Y ${suffix}`,
    version: "1.0.0",
    modelProvider: "anthropic",
    modelId: "claude-mock",
    systemPrompt: "y",
    ownerId: user.id,
  });

  const uniqueKeyword = `pattern_gate_${suffix}`;
  const policy = await createCheckpointPolicy({
    orgId,
    name: `Pattern gate ${suffix}`,
    triggerType: "keyword",
    triggerConfig: { keyword: uniqueKeyword },
    requiredRole: "owner",
    active: true,
  });

  // Org-wide default — must STILL fire on pattern-created sessions (additive)
  const distractorKeyword = `distractor_${suffix}`;
  const distractorPolicy = await createCheckpointPolicy({
    orgId,
    name: `Distractor ${suffix}`,
    triggerType: "keyword",
    triggerConfig: { keyword: distractorKeyword },
    requiredRole: "owner",
    active: true,
  });

  // 1. Create pattern with 3 steps
  const pattern = await createPattern({
    orgId,
    name: `Research → Draft → Review ${suffix}`,
    steps: [
      { label: "Research", agent_id: agentX.id, checkpoint_policy_id: null },
      {
        label: "Draft",
        agent_id: agentY.id,
        checkpoint_policy_id: policy.id,
      },
      { label: "Review", role: "reviewer", checkpoint_policy_id: null },
    ],
  });
  if (pattern.steps.length !== 3) {
    throw new Error("Expected 3 steps on pattern");
  }
  console.log("created pattern", pattern.id);

  // 4. Library list includes it
  const listed = await listOrgPatterns(orgId);
  if (!listed.some((p) => p.id === pattern.id)) {
    throw new Error("Pattern missing from org list");
  }
  console.log("org list includes pattern ok");

  // 2. Spin up
  const { session } = await spinUpSessionFromPattern({
    orgId,
    userId: user.id,
    patternId: pattern.id,
    title: `Spun ${suffix}`,
  });

  if (session.agentId !== agentX.id) {
    throw new Error(
      `Expected agent X (${agentX.id}) on session, got ${session.agentId}`
    );
  }
  if (session.workflowPatternId !== pattern.id) {
    throw new Error("workflow_pattern_id not set");
  }
  const attached = session.attachedCheckpointPolicyIds;
  if (
    !Array.isArray(attached) ||
    attached.length !== 1 ||
    attached[0] !== policy.id
  ) {
    throw new Error(
      `Expected attached policies [${policy.id}], got ${JSON.stringify(attached)}`
    );
  }

  const events = await listSessionEvents(session.id, 0);
  const scaffold = events.find((e) => e.eventType === "pattern_scaffold");
  if (!scaffold) throw new Error("Missing pattern_scaffold event");
  console.log("spin-up wiring ok agent=", session.agentId);

  // 3a. Pattern-attached keyword still fires
  const userEvent = await appendSessionEvent({
    sessionId: session.id,
    eventType: "user_message",
    actorId: user.id,
    actorType: "human",
    payload: { content: `please ${uniqueKeyword} to prod` },
  });
  const raised = await maybeRaiseCheckpointForUserMessage({
    sessionId: session.id,
    orgId,
    actorId: user.id,
    userMessageEvent: userEvent,
    content: `please ${uniqueKeyword} to prod`,
  });
  if (!raised.paused || !raised.checkpoint) {
    throw new Error("Expected attached keyword policy to raise checkpoint");
  }
  const raisedPolicyId = (raised.checkpoint.payload as { policy_id?: string })
    .policy_id;
  if (raisedPolicyId !== policy.id) {
    throw new Error(`Wrong policy raised: ${raisedPolicyId}`);
  }
  console.log("attached policy fires ok");

  // 3b. Org-wide default (distractor) ALSO fires on pattern sessions (additive)
  const { session: session2 } = await spinUpSessionFromPattern({
    orgId,
    userId: user.id,
    patternId: pattern.id,
    title: `Spun org-wide check ${suffix}`,
  });
  const distractorMsg = await appendSessionEvent({
    sessionId: session2.id,
    eventType: "user_message",
    actorId: user.id,
    actorType: "human",
    payload: { content: `mention ${distractorKeyword} only` },
  });
  const orgRaised = await maybeRaiseCheckpointForUserMessage({
    sessionId: session2.id,
    orgId,
    actorId: user.id,
    userMessageEvent: distractorMsg,
    content: `mention ${distractorKeyword} only`,
  });
  if (!orgRaised.paused || !orgRaised.checkpoint) {
    throw new Error(
      "Org-wide default policy must still fire on pattern-created sessions"
    );
  }
  const orgPolicyId = (orgRaised.checkpoint.payload as { policy_id?: string })
    .policy_id;
  if (orgPolicyId !== distractorPolicy.id) {
    throw new Error(`Expected distractor policy, got ${orgPolicyId}`);
  }
  console.log("org-wide default still fires on pattern session ok");

  // 3c. Both match independently via evaluatePolicies when text hits both keywords
  const { evaluatePolicies } = await import("../src/lib/checkpoints");
  const { session: session3 } = await spinUpSessionFromPattern({
    orgId,
    userId: user.id,
    patternId: pattern.id,
    title: `Spun both ${suffix}`,
  });
  const both = await evaluatePolicies({
    orgId,
    sessionId: session3.id,
    trigger: {
      type: "keyword",
      text: `please ${uniqueKeyword} and ${distractorKeyword}`,
    },
  });
  const bothIds = new Set(both.map((m) => m.policy.id));
  if (!bothIds.has(policy.id) || !bothIds.has(distractorPolicy.id)) {
    throw new Error(
      `Expected both policies to match independently, got ${[...bothIds].join(",")}`
    );
  }
  console.log("both policies coexist / match independently ok");

  // Soft cleanup — keep spun sessions; deactivate test policies/agents
  await db
    .update(checkpointPolicies)
    .set({ active: false })
    .where(
      and(
        eq(checkpointPolicies.orgId, orgId),
        eq(checkpointPolicies.name, `Pattern gate ${suffix}`)
      )
    );
  await db
    .update(checkpointPolicies)
    .set({ active: false })
    .where(
      and(
        eq(checkpointPolicies.orgId, orgId),
        eq(checkpointPolicies.name, `Distractor ${suffix}`)
      )
    );
  await db
    .update(agents)
    .set({ status: "archived" })
    .where(eq(agents.id, agentX.id));
  await db
    .update(agents)
    .set({ status: "archived" })
    .where(eq(agents.id, agentY.id));
  void workflowPatterns;
  void sessions;

  console.log("\nSTEP 22 VERIFY OK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
