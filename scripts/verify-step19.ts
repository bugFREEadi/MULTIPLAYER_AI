/**
 * Step 19 verification harness — run with:
 *   npx tsx scripts/verify-step19.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const {
    memoryFacts,
    sessionMembers,
    sessions,
    users,
  } = await import("../src/db/schema");
  const { embedText } = await import("../src/lib/embeddings");
  const { listSessionEvents } = await import("../src/lib/events");
  const {
    completeTaskNode,
    planDelegation,
  } = await import("../src/lib/manager-agent");

  const [user] = await db.select().from(users).limit(1);
  if (!user?.orgId) throw new Error("Need a user with orgId");
  const orgId = user.orgId;

  // Seed a curated company fact so Chief-of-Staff recall has something to pull.
  const factText =
    "Decision: to use Postgres with pgvector for Team AI Memory storage.";
  await db.insert(memoryFacts).values({
    orgId,
    scope: "company",
    scopeId: orgId,
    fact: factText,
    embedding: await embedText(factText),
    status: "curated",
  });

  const [parent] = await db
    .insert(sessions)
    .values({
      orgId,
      title: "step19-parent",
      createdBy: user.id,
      status: "active",
      visibility: "internal_only",
    })
    .returning();
  await db.insert(sessionMembers).values({
    sessionId: parent.id,
    userId: user.id,
    role: "owner",
  });

  const goal =
    "Ship Team AI Memory with Postgres pgvector and a Manager Agent plan";

  const planned = await planDelegation({
    parentSessionId: parent.id,
    orgId,
    userId: user.id,
    goal,
  });

  console.log("graph", {
    id: planned.graph.id,
    status: planned.graph.status,
    goal: planned.graph.goal,
  });
  console.log(
    "nodes",
    planned.nodes.map((n) => ({
      title: n.title,
      status: n.status,
      deps: n.dependsOn,
      child: n.childSessionId,
      type: n.assignedToType,
    }))
  );
  console.log(
    "recalled",
    planned.recalledFacts.map((f) => f.fact.slice(0, 60))
  );

  if (planned.nodes.length !== 3) {
    throw new Error(`Expected 3 mock nodes, got ${planned.nodes.length}`);
  }
  if (!planned.nodes.every((n) => n.childSessionId)) {
    throw new Error("Every node must spawn a child session");
  }
  if (planned.recalledFacts.length < 1) {
    throw new Error("Chief-of-Staff should recall at least one memory fact");
  }

  const [n0, n1, n2] = planned.nodes;
  if (n0.status !== "in_progress") {
    throw new Error(`Node0 should be in_progress, got ${n0.status}`);
  }
  if (n1.status !== "blocked" || n2.status !== "blocked") {
    throw new Error(
      `Node1/2 should start blocked, got ${n1.status}/${n2.status}`
    );
  }

  // Completing dependent node while blocked must fail
  let blockedError = false;
  try {
    await completeTaskNode({ nodeId: n1.id });
  } catch {
    blockedError = true;
  }
  if (!blockedError) {
    throw new Error("Completing blocked node should fail");
  }

  const after0 = await completeTaskNode({ nodeId: n0.id });
  const n1After = after0.nodes.find((n) => n.id === n1.id)!;
  const n2After = after0.nodes.find((n) => n.id === n2.id)!;
  console.log("after node0", {
    n1: n1After.status,
    n2: n2After.status,
    graph: after0.graph.status,
  });
  if (n1After.status !== "in_progress") {
    throw new Error("Node1 should unblock to in_progress after node0 completes");
  }
  if (n2After.status !== "blocked") {
    throw new Error("Node2 should still be blocked until node1 completes");
  }

  const after1 = await completeTaskNode({ nodeId: n1.id });
  const n2b = after1.nodes.find((n) => n.id === n2.id)!;
  if (n2b.status !== "in_progress") {
    throw new Error("Node2 should become in_progress after node1 completes");
  }

  const after2 = await completeTaskNode({ nodeId: n2.id });
  console.log("final graph", after2.graph.status, "synthesized", after2.synthesized);
  if (after2.graph.status !== "completed" || !after2.synthesized) {
    throw new Error("Graph should synthesize and complete after all nodes done");
  }

  const parentEvents = await listSessionEvents(parent.id, 0);
  const brief = parentEvents.find((e) => e.eventType === "manager_brief");
  const synthesis = parentEvents.find(
    (e) => e.eventType === "delegation_synthesis"
  );
  if (!brief) throw new Error("Missing manager_brief on parent");
  if (!synthesis) throw new Error("Missing delegation_synthesis on parent");
  const synContent =
    synthesis.payload &&
    typeof synthesis.payload === "object" &&
    "content" in synthesis.payload
      ? String((synthesis.payload as { content: unknown }).content)
      : "";
  if (!synContent.includes(goal.slice(0, 20))) {
    throw new Error("Synthesis should reference the goal");
  }

  // Confirm child sessions exist
  for (const n of planned.nodes) {
    const [child] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, n.childSessionId!))
      .limit(1);
    if (!child) throw new Error(`Missing child session ${n.childSessionId}`);
  }

  console.log("\nSTEP 19 VERIFY OK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
