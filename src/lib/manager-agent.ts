import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  sessionMembers,
  sessions,
  taskGraphs,
  taskNodes,
} from "@/db/schema";
import { AuthError } from "@/lib/auth-error";
import { appendSessionEvent, listSessionEvents } from "@/lib/events";
import { isMockAiEnabled } from "@/lib/mock-ai";
import { retrieveMemoryForSession } from "@/lib/memory";
import { inngest } from "@/inngest/client";

export type TaskGraphRow = typeof taskGraphs.$inferSelect;
export type TaskNodeRow = typeof taskNodes.$inferSelect;

export type MockPlanNode = {
  title: string;
  assignedToType: "agent" | "human";
  /** Indices into the plan array that must complete first. */
  dependsOnIndices: number[];
};

/**
 * Canned decomposition — exercises graph plumbing only.
 * Does NOT simulate real goal-decomposition quality or sensibility.
 */
export function mockDecomposeGoal(goal: string): MockPlanNode[] {
  const short = goal.trim().slice(0, 48) || "the goal";
  return [
    {
      title: `Gather context for: ${short}`,
      assignedToType: "agent",
      dependsOnIndices: [],
    },
    {
      title: `Draft approach for: ${short}`,
      assignedToType: "agent",
      dependsOnIndices: [0],
    },
    {
      title: `Human review: ${short}`,
      assignedToType: "human",
      dependsOnIndices: [1],
    },
  ];
}

async function realDecomposeGoal(_goal: string): Promise<MockPlanNode[]> {
  throw new AuthError(
    "Real goal decomposition requires MOCK_AI_RESPONSES=false and a wired model — not configured yet",
    501
  );
}

export async function decomposeGoal(goal: string): Promise<MockPlanNode[]> {
  if (isMockAiEnabled()) {
    return mockDecomposeGoal(goal);
  }
  return realDecomposeGoal(goal);
}

function payloadContent(payload: unknown): string {
  if (payload && typeof payload === "object" && "content" in payload) {
    const c = (payload as { content: unknown }).content;
    if (typeof c === "string") return c;
  }
  return "";
}

async function pickOrgAgentId(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), eq(agents.status, "active")))
    .orderBy(asc(agents.name))
    .limit(1);
  return row?.id ?? null;
}

async function createChildSession(opts: {
  orgId: string;
  parentSessionId: string;
  title: string;
  createdBy: string;
  agentId: string | null;
}) {
  const [session] = await db
    .insert(sessions)
    .values({
      orgId: opts.orgId,
      title: opts.title,
      createdBy: opts.createdBy,
      agentId: opts.agentId,
      status: "active",
      visibility: "internal_only",
      parentSessionId: opts.parentSessionId,
    })
    .returning();

  await db.insert(sessionMembers).values({
    sessionId: session.id,
    userId: opts.createdBy,
    role: "owner",
  });

  await appendSessionEvent({
    sessionId: session.id,
    eventType: "user_message",
    actorId: opts.createdBy,
    actorType: "human",
    payload: {
      content: `Delegated task: ${opts.title}`,
      delegated: true,
    },
  });

  return session;
}

export async function getTaskGraphForSession(parentSessionId: string) {
  const [graph] = await db
    .select()
    .from(taskGraphs)
    .where(eq(taskGraphs.parentSessionId, parentSessionId))
    .orderBy(desc(taskGraphs.createdAt))
    .limit(1);
  if (!graph) return null;
  const nodes = await db
    .select()
    .from(taskNodes)
    .where(eq(taskNodes.taskGraphId, graph.id))
    .orderBy(asc(taskNodes.createdAt));
  return { graph, nodes };
}

export async function getTaskGraphById(graphId: string) {
  const [graph] = await db
    .select()
    .from(taskGraphs)
    .where(eq(taskGraphs.id, graphId))
    .limit(1);
  if (!graph) return null;
  const nodes = await db
    .select()
    .from(taskNodes)
    .where(eq(taskNodes.taskGraphId, graphId))
    .orderBy(asc(taskNodes.createdAt));
  return { graph, nodes };
}

/**
 * Chief-of-Staff recall: reuse Step 18 retrieval scoped to the goal text.
 */
export async function chiefOfStaffRecall(opts: {
  orgId: string;
  sessionId: string;
  userId: string;
  goal: string;
}) {
  return retrieveMemoryForSession({
    orgId: opts.orgId,
    sessionId: opts.sessionId,
    userId: opts.userId,
    contextText: opts.goal,
    topK: 5,
  });
}

/**
 * Manager Agent: plan a goal on a parent session.
 * 1) Chief-of-Staff memory recall
 * 2) Decompose (mock canned plan in mock mode)
 * 3) Persist graph + nodes + child sessions
 * 4) Start nodes with no unmet dependencies
 */
export async function planDelegation(opts: {
  parentSessionId: string;
  orgId: string;
  userId: string;
  goal: string;
}): Promise<{
  graph: TaskGraphRow;
  nodes: TaskNodeRow[];
  recalledFacts: Awaited<ReturnType<typeof chiefOfStaffRecall>>;
}> {
  const goal = opts.goal.trim();
  if (!goal) {
    throw new AuthError("goal is required", 400);
  }

  const existing = await getTaskGraphForSession(opts.parentSessionId);
  if (existing && existing.graph.status !== "completed") {
    throw new AuthError(
      "Parent session already has an active task graph — complete it first",
      409
    );
  }

  const recalledFacts = await chiefOfStaffRecall({
    orgId: opts.orgId,
    sessionId: opts.parentSessionId,
    userId: opts.userId,
    goal,
  });

  await appendSessionEvent({
    sessionId: opts.parentSessionId,
    eventType: "manager_brief",
    actorId: null,
    actorType: "agent",
    payload: {
      goal,
      recalled_facts: recalledFacts.map((f) => ({
        id: f.id,
        fact: f.fact,
        scope: f.scope,
        sourceSessionId: f.sourceSessionId,
        sourceEventSeq: f.sourceEventSeq,
      })),
      mock: isMockAiEnabled(),
      note: isMockAiEnabled()
        ? "[MOCK CHIEF OF STAFF] Memory recall for planning (pipeline only)"
        : "Chief of Staff recall for planning",
    },
  });

  const plan = await decomposeGoal(goal);
  const agentId = await pickOrgAgentId(opts.orgId);

  const [graph] = await db
    .insert(taskGraphs)
    .values({
      parentSessionId: opts.parentSessionId,
      goal,
      status: "planning",
    })
    .returning();

  // Insert nodes with placeholder depends_on, then rewrite IDs.
  const inserted: TaskNodeRow[] = [];
  for (const step of plan) {
    const [node] = await db
      .insert(taskNodes)
      .values({
        taskGraphId: graph.id,
        title: step.title,
        assignedToType: step.assignedToType,
        assignedToId:
          step.assignedToType === "agent" ? agentId : opts.userId,
        dependsOn: [],
        status: "pending",
      })
      .returning();
    inserted.push(node);
  }

  for (let i = 0; i < plan.length; i++) {
    const depIds = plan[i].dependsOnIndices.map((idx) => inserted[idx].id);
    const [updated] = await db
      .update(taskNodes)
      .set({ dependsOn: depIds })
      .where(eq(taskNodes.id, inserted[i].id))
      .returning();
    inserted[i] = updated;
  }

  // Spawn child sessions for every node; start ready ones.
  for (let i = 0; i < inserted.length; i++) {
    const node = inserted[i];
    const child = await createChildSession({
      orgId: opts.orgId,
      parentSessionId: opts.parentSessionId,
      title: `[Task] ${node.title}`,
      createdBy: opts.userId,
      agentId: node.assignedToType === "agent" ? node.assignedToId : null,
    });
    const ready = (node.dependsOn ?? []).length === 0;
    const [updated] = await db
      .update(taskNodes)
      .set({
        childSessionId: child.id,
        status: ready ? "in_progress" : "blocked",
      })
      .where(eq(taskNodes.id, node.id))
      .returning();
    inserted[i] = updated;
  }

  const [started] = await db
    .update(taskGraphs)
    .set({ status: "in_progress" })
    .where(eq(taskGraphs.id, graph.id))
    .returning();

  await appendSessionEvent({
    sessionId: opts.parentSessionId,
    eventType: "task_graph_created",
    actorId: opts.userId,
    actorType: "human",
    payload: {
      task_graph_id: started.id,
      goal,
      node_count: inserted.length,
      mock_decomposition: isMockAiEnabled(),
      nodes: inserted.map((n) => ({
        id: n.id,
        title: n.title,
        status: n.status,
        depends_on: n.dependsOn,
        child_session_id: n.childSessionId,
        assigned_to_type: n.assignedToType,
      })),
    },
  });

  return { graph: started, nodes: inserted, recalledFacts };
}

function depsSatisfied(
  node: TaskNodeRow,
  completedIds: Set<string>
): boolean {
  const deps = node.dependsOn ?? [];
  return deps.every((id) => completedIds.has(id));
}

export async function synthesizeTaskGraph(graphId: string): Promise<{
  graph: TaskGraphRow;
  synthesisEventId: string;
}> {
  const bundle = await getTaskGraphById(graphId);
  if (!bundle) {
    throw new AuthError("Task graph not found", 404);
  }
  const { graph, nodes } = bundle;
  if (graph.status === "completed") {
    return { graph, synthesisEventId: "" };
  }

  const summaries: string[] = [];
  for (const node of nodes) {
    if (!node.childSessionId) {
      summaries.push(`- ${node.title}: (no child session)`);
      continue;
    }
    const events = await listSessionEvents(node.childSessionId, 0);
    const last = [...events]
      .reverse()
      .find(
        (e) =>
          e.eventType === "agent_message" || e.eventType === "user_message"
      );
    const snippet = last ? payloadContent(last.payload).slice(0, 200) : "(empty)";
    summaries.push(
      `- [${node.status}] ${node.title} → ${snippet}${isMockAiEnabled() ? " [MOCK]" : ""}`
    );
  }

  const content = [
    isMockAiEnabled()
      ? "[MOCK SYNTHESIS] Delegation complete."
      : "Delegation complete.",
    `Goal: ${graph.goal}`,
    "Node outcomes:",
    ...summaries,
  ].join("\n");

  const event = await appendSessionEvent({
    sessionId: graph.parentSessionId,
    eventType: "delegation_synthesis",
    actorId: null,
    actorType: "agent",
    payload: {
      content,
      task_graph_id: graph.id,
      mock: isMockAiEnabled(),
    },
  });

  const [updated] = await db
    .update(taskGraphs)
    .set({ status: "completed" })
    .where(eq(taskGraphs.id, graphId))
    .returning();

  return { graph: updated, synthesisEventId: event.id };
}

/**
 * Advance graph after a node completes: unblock dependents, synthesize if done.
 * Idempotent — safe for sync caller + Inngest dual-path.
 */
export async function advanceTaskGraph(graphId: string): Promise<{
  graph: TaskGraphRow;
  nodes: TaskNodeRow[];
  synthesized: boolean;
}> {
  const bundle = await getTaskGraphById(graphId);
  if (!bundle) {
    throw new AuthError("Task graph not found", 404);
  }
  let { graph, nodes } = bundle;

  if (graph.status === "completed") {
    return { graph, nodes, synthesized: false };
  }

  const completedIds = new Set(
    nodes.filter((n) => n.status === "completed").map((n) => n.id)
  );

  for (const node of nodes) {
    if (node.status !== "blocked" && node.status !== "pending") continue;
    if (!depsSatisfied(node, completedIds)) continue;
    const [updated] = await db
      .update(taskNodes)
      .set({ status: "in_progress" })
      .where(eq(taskNodes.id, node.id))
      .returning();
    node.status = updated.status;
  }

  nodes = await db
    .select()
    .from(taskNodes)
    .where(eq(taskNodes.taskGraphId, graphId))
    .orderBy(asc(taskNodes.createdAt));

  const allDone = nodes.every((n) => n.status === "completed");
  let synthesized = false;
  if (allDone) {
    const result = await synthesizeTaskGraph(graphId);
    graph = result.graph;
    synthesized = true;
  }

  return { graph, nodes, synthesized };
}

export async function completeTaskNode(opts: {
  nodeId: string;
  actorId?: string | null;
}): Promise<{
  node: TaskNodeRow;
  graph: TaskGraphRow;
  nodes: TaskNodeRow[];
  synthesized: boolean;
}> {
  const [node] = await db
    .select()
    .from(taskNodes)
    .where(eq(taskNodes.id, opts.nodeId))
    .limit(1);
  if (!node) {
    throw new AuthError("Task node not found", 404);
  }
  if (node.status === "completed") {
    const advanced = await advanceTaskGraph(node.taskGraphId);
    return { node, ...advanced };
  }
  if (node.status === "blocked") {
    throw new AuthError(
      "Cannot complete a blocked node — dependencies unfinished",
      409
    );
  }

  if (node.childSessionId) {
    await appendSessionEvent({
      sessionId: node.childSessionId,
      eventType: "agent_message",
      actorId: null,
      actorType: "agent",
      payload: {
        content: isMockAiEnabled()
          ? `[MOCK] Task completed: ${node.title}`
          : `Task completed: ${node.title}`,
        task_node_id: node.id,
        completed: true,
      },
    });
  }

  const [updated] = await db
    .update(taskNodes)
    .set({ status: "completed" })
    .where(eq(taskNodes.id, node.id))
    .returning();

  // Sync advance (source of truth). Inngest mirrors for durable retries.
  const advanced = await advanceTaskGraph(updated.taskGraphId);

  try {
    await inngest.send({
      name: "manager/node.completed",
      data: {
        nodeId: updated.id,
        taskGraphId: updated.taskGraphId,
      },
    });
  } catch {
    /* Inngest optional in local verify */
  }

  return { node: updated, ...advanced };
}

export async function listNodesByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(taskNodes).where(inArray(taskNodes.id, ids));
}
