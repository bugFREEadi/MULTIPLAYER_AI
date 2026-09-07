import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  numeric,
  unique,
  primaryKey,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Foundational schema — Phase 1 Step 1
 * Source: multiplayer-ai-technical-buildguide.md Section 2
 */

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  orgId: uuid("org_id").references(() => orgs.id),
  name: text("name"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id),
  title: text("title"),
  status: text("status").notNull().default("active"),
  sessionTemplate: text("session_template"),
  visibility: text("visibility").notNull().default("internal_only"),
  parentSessionId: uuid("parent_session_id").references(
    (): AnyPgColumn => sessions.id
  ),
  forkedFromEventSeq: integer("forked_from_event_seq"),
  /** Bound Agent Fleet agent for this session (Step 17). */
  agentId: uuid("agent_id"),
  /** Pattern Library source — Feature 2.6 / Step 22. */
  workflowPatternId: uuid("workflow_pattern_id").references(
    (): AnyPgColumn => workflowPatterns.id
  ),
/**
   * When set (including []), records pattern-attached policy IDs for scaffold UI.
   * Evaluation is always additive: all active org policies apply (Step 10 baseline);
   * attached IDs do not exclude org-wide policies.
   */
  attachedCheckpointPolicyIds: jsonb(
    "attached_checkpoint_policy_ids"
  ).$type<string[] | null>(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const sessionMembers = pgTable(
  "session_members",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    isGuest: boolean("is_guest").default(false),
    guestOrgName: text("guest_org_name"),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.userId] })]
);

export const sessionEvents = pgTable(
  "session_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    sequenceNumber: integer("sequence_number").notNull(),
    eventType: text("event_type").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    actorType: text("actor_type").notNull(),
    payload: jsonb("payload").notNull(),
    tokenUsage: jsonb("token_usage"),
    costUsd: numeric("cost_usd"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("session_events_session_id_sequence_number_unique").on(
      table.sessionId,
      table.sequenceNumber
    ),
    index("session_events_session_id_sequence_number_idx").on(
      table.sessionId,
      table.sequenceNumber
    ),
  ]
);

/**
 * Org checkpoint policies — Feature 1.3 / Step 10.
 * Evaluated by the single policy evaluator before agent actions.
 */
export const checkpointPolicies = pgTable(
  "checkpoint_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    triggerType: text("trigger_type").notNull(),
    triggerConfig: jsonb("trigger_config").notNull(),
    requiredRole: text("required_role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("checkpoint_policies_org_id_active_idx").on(table.orgId, table.active),
  ]
);

/**
 * Human-authored merge audit trail — Feature 1.4 / Step 11.
 * Does not auto-merge event content; records the decision only.
 */
export const branchMerges = pgTable("branch_merges", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceSessionId: uuid("source_session_id")
    .notNull()
    .references(() => sessions.id),
  targetSessionId: uuid("target_session_id")
    .notNull()
    .references(() => sessions.id),
  mergedBy: uuid("merged_by").references(() => users.id),
  mergeSummary: text("merge_summary"),
  rejectedBranches: uuid("rejected_branches").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * Org monthly budget guardrails — Feature 1.8 / Step 13.
 * soft_locked / alert_active are maintained by the spend-check job (and
 * also derived live on write paths so soft-lock does not wait for cron).
 */
export const budgetLimits = pgTable("budget_limits", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id),
  monthlyLimitUsd: numeric("monthly_limit_usd").notNull(),
  alertThresholdPct: integer("alert_threshold_pct").notNull().default(80),
  softLocked: boolean("soft_locked").notNull().default(false),
  alertActive: boolean("alert_active").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/**
 * Org tool connectors — Feature 1.9 / Step 14.
 * auth_config stores AES-GCM ciphertext envelope (never raw tokens).
 */
export const connectedTools = pgTable(
  "connected_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    toolName: text("tool_name").notNull(),
    authConfig: jsonb("auth_config").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("connected_tools_org_id_tool_name_unique").on(
      table.orgId,
      table.toolName
    ),
    index("connected_tools_org_id_idx").on(table.orgId),
  ]
);

/**
 * Tool invocation permissions — Feature 1.9 / Step 14, scoped per-agent in Step 17.
 * agent_id null = org-default permission for the tool.
 * Uniqueness: one org-default row + one row per (org, tool, agent) — enforced in SQL migration.
 */
export const agentToolPermissions = pgTable(
  "agent_tool_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    agentId: uuid("agent_id"),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => connectedTools.id),
    permission: text("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("agent_tool_permissions_org_id_idx").on(table.orgId)]
);

/**
 * Agent Fleet registry — Feature 2.4 / Step 17.
 */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    version: text("version").notNull(),
    modelProvider: text("model_provider").notNull(),
    modelId: text("model_id").notNull(),
    systemPrompt: text("system_prompt"),
    ownerId: uuid("owner_id").references(() => users.id),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("agents_org_id_status_idx").on(table.orgId, table.status)]
);

/**
 * Per-turn agent execution records — Feature 2.4 / Step 17.
 * outcome: success | failure | escalated (e.g. checkpoint pause).
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    outcome: text("outcome"),
  },
  (table) => [
    index("agent_runs_agent_id_idx").on(table.agentId),
    index("agent_runs_session_id_idx").on(table.sessionId),
  ]
);

/**
 * Team AI Memory facts — Feature 2.1 / Step 18.
 * scope: company | team | project | personal
 * status: pending | curated | rejected
 *
 * embedding: float[1536] stored as jsonb for now — host Postgres lacks the
 * `vector` extension. When pgvector is available, migrate to vector(1536) +
 * HNSW; retrieval API stays the same.
 */
export const memoryFacts = pgTable(
  "memory_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    scope: text("scope").notNull(),
    scopeId: uuid("scope_id"),
    fact: text("fact").notNull(),
    embedding: jsonb("embedding").$type<number[]>(),
    sourceSessionId: uuid("source_session_id").references(() => sessions.id),
    sourceEventSeq: integer("source_event_seq"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("memory_facts_org_id_status_idx").on(table.orgId, table.status),
    index("memory_facts_source_session_id_idx").on(table.sourceSessionId),
  ]
);

/**
 * Delegation / Manager Agent — Feature 2.3 / Step 19.
 * Postgres is source of truth; Inngest only drives transitions.
 * status: planning | in_progress | completed
 */
export const taskGraphs = pgTable(
  "task_graphs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentSessionId: uuid("parent_session_id")
      .notNull()
      .references(() => sessions.id),
    goal: text("goal").notNull(),
    status: text("status").notNull().default("planning"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("task_graphs_parent_session_id_idx").on(table.parentSessionId),
  ]
);

/**
 * Nodes in a task graph.
 * assigned_to_type: agent | human
 * status: pending | in_progress | completed | blocked
 * depends_on: other task_node ids that must complete first
 */
export const taskNodes = pgTable(
  "task_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskGraphId: uuid("task_graph_id")
      .notNull()
      .references(() => taskGraphs.id),
    title: text("title").notNull(),
    assignedToType: text("assigned_to_type").notNull(),
    assignedToId: uuid("assigned_to_id"),
    childSessionId: uuid("child_session_id").references(() => sessions.id),
    dependsOn: uuid("depends_on").array().notNull().default([]),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("task_nodes_task_graph_id_idx").on(table.taskGraphId)]
);

/**
 * Pattern Library — Feature 2.6 / Step 22.
 * Manually authored here; Step 23 playbook extraction populates
 * created_from_session_id on the same table.
 * steps: ordered { agent_id?, role?, checkpoint_policy_id?, label? }
 */
export const workflowPatterns = pgTable(
  "workflow_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    steps: jsonb("steps")
      .$type<
        Array<{
          agent_id?: string | null;
          role?: string | null;
          checkpoint_policy_id?: string | null;
          label?: string | null;
        }>
      >()
      .notNull(),
    createdFromSessionId: uuid("created_from_session_id").references(
      () => sessions.id
    ),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("workflow_patterns_org_id_idx").on(table.orgId)]
);

/**
 * Guest magic-link invites — Feature 2.2 / Step 20.
 * Auth is token-only (cookie after redeem), fully separate from Clerk.
 */
export const guestInvites = pgTable(
  "guest_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    token: text("token").notNull().unique(),
    role: text("role").notNull(),
    guestOrgName: text("guest_org_name"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    redeemedUserId: uuid("redeemed_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("guest_invites_session_id_idx").on(table.sessionId),
    index("guest_invites_token_idx").on(table.token),
  ]
);
