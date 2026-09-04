# Multiplayer AI — Complete Technical Spec (Every Feature, Every Phase)

This covers every feature in the founder's handbook — the original 10, the Phase 1 launch extras, the Phase 2 expansion features, the Phase 3 moat features, and the scattered extras (RBAC matrix, marketplace, guest access). Nothing is cut here. Sequencing still matters — some features are hard dependencies for others — so this is organized by build phase, not by the document's original ordering. A dedup map is included since several items in the doc are the same feature described twice under different names.

**Honest framing, stated once:** this is now a 6-9+ month, likely multi-engineer roadmap, not a solo 8-week build. Phase 1 below *is* the 8-week plan from before. Phases 2 and 3 are what comes after you have real users on Phase 1. I'm giving you the full architecture for all of it so nothing is a surprise later, but I'd be doing you a disservice if I didn't say directly: build Phase 1, get it in front of real teams, and let what they actually ask for reprioritize Phases 2 and 3 — don't build them in this exact order just because they're written down.

---

## Dedup Map (features described more than once in the source doc)

| Canonical feature | Also appears as |
|---|---|
| Feature 5 — Team AI Memory | "Organizational Memory Graph + Ask the Company" (Phase 3), "AI Chief of Staff" partial |
| Feature 7 — Cross-Org Collaboration | "Cross-Org Collaboration + No-Account Guest Access", "Cross-Org AI Graph" (Phase 3, adds analytics on top) |
| Feature 9 — Delegation Chains | "Dynamic Role Allocation / AI Manager for Goals" (Phase 2), "AI Chief of Staff / Manager Agent" |
| Feature 10 — Session Intelligence & Analytics | "AI Outcomes Analytics" (Phase 3, adds recommendations on top) |
| Feature 8 — Session Replay & Playbooks | "Session Timeline + Time-Travel Debugging" (Phase 1 launch), "Pattern Library" (Phase 2, templates vs. extracted playbooks — related but distinct, treated separately below) |

Everything else (Checkpoint System, Branching, Roles, Cost Meter, Tool Mesh, Incident Canvas, Agent Fleet, Context Spine, Compliance Vault, Marketplace) is a genuinely distinct feature and gets its own section.

---

# PHASE 1 — Core Platform (Months 1-2)

Goal: the AI Work Session object works completely — multiplayer, governed, branchable, replayable. This is the 8-week plan from before, restated briefly, plus the three Phase-1-launch items that weren't in it yet.

### 1.1 Shared AI Work Sessions (Feature 1 — Live Co-Piloting)
- **Data model:** `sessions`, `session_members`, `session_events` (event log, as specified previously)
- **Backend:** session CRUD, event append/read API, Redis pub/sub fan-out, WebSocket/Ably gateway, "take control" endpoint
- **Frontend:** session view rendering the event log, Liveblocks presence/cursors, streaming agent responses
- **Note on "Suggest" mode** (called out as missing before): add a `suggestion` event type — a non-pilot participant can post a suggested next message that appears as a distinct card in the timeline; the pilot can accept it (which re-posts it as a `user_message`) or dismiss it. Small addition, same event-log mechanism.

### 1.2 Role-Based Participation (Feature 6)
- **Data model:** `role` enum column on `session_members` (owner/pilot/co_pilot/reviewer/observer/auditor)
- **Backend:** role-check middleware on every write endpoint
- **Frontend:** role badges, permission-gated UI controls

### 1.3 Checkpoint System (Feature 4)
- **Data model:** `checkpoint_raised` / `checkpoint_resolved` event types; add a `checkpoint_policies` table now (see below) rather than hard-coding trigger conditions
```sql
create table checkpoint_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  name text not null,               -- "Finance approval over $10k"
  trigger_type text not null,       -- keyword | tool_call | budget_threshold | manual
  trigger_config jsonb not null,    -- e.g. {"tool": "send_email"} or {"threshold_usd": 10000}
  required_role text not null,      -- who must approve
  active boolean default true
);
```
  This is the piece that was missing before — a configurable policy table instead of hard-coded checks. Agent runtime evaluates active policies for the org before each tool call / message and raises a checkpoint if one matches.
- **Backend:** policy CRUD API, policy evaluation in the agent execution loop (Inngest/Trigger.dev step before any tool call), resolve endpoint
- **Frontend:** checkpoint card in timeline (Approve/Reject), a simple policy management page under org settings (list/create/toggle policies)

### 1.4 Divergent Exploration / Branching (Feature 3)
- **Data model:** `parent_session_id`, `forked_from_event_seq` on `sessions` (as before). Add a `branch_merges` table for the audit trail of what was merged/rejected:
```sql
create table branch_merges (
  id uuid primary key default gen_random_uuid(),
  source_session_id uuid references sessions(id),
  target_session_id uuid references sessions(id),
  merged_by uuid references users(id),
  merge_summary text,       -- what was pulled in
  rejected_branches uuid[], -- other branch ids considered and not merged, for the audit trail
  created_at timestamptz default now()
);
```
- **Backend:** branch endpoint, merge endpoint (still human-driven — write the summary and mark rejected alternatives, don't auto-merge content)
- **Frontend:** branch button, side-by-side compare, merge action that records the decision

### 1.5 Async Session Threads (Feature 2)
- **Data model:** `handoff_brief` event type; a `pending_decisions` view (computed, not a table — query for unresolved `checkpoint_raised` events with no matching `checkpoint_resolved`)
- **Backend:** handoff generation job (LLM summary of events since last handoff marker), scheduled or on-demand
- **Frontend:** handoff brief card, "pending decisions" panel per session

### 1.6 Session Replay & Playbooks — the replay half (Feature 8, part 1)
- **Frontend:** timeline scrubber over the event log, "jump to moment," state reconstruction by replaying events 0..N (no new backend work — this reads the same event log)

### 1.7 Session Timeline + Time-Travel Debugging (Phase 1 launch item)
This *is* 1.6 — same feature, same implementation, the doc names it twice. No additional work beyond 1.6.

### 1.8 Outcome Cost Meter + Budget Guardrails (Phase 1 launch item)
- **Data model:** add `token_usage jsonb` and `cost_usd numeric` columns to `session_events` (populated on every `agent_message`/`tool_call` event from the model provider's usage response). Add:
```sql
create table budget_limits (
  org_id uuid references orgs(id) primary key,
  monthly_limit_usd numeric not null,
  alert_threshold_pct int default 80
);
```
- **Backend:** running cost aggregation per session (sum of `cost_usd` in `session_events`) exposed via `GET /sessions/:id/cost`; a scheduled job checks org-level monthly spend against `budget_limits` and fires alerts/soft-locks (block new sessions, don't kill running ones)
- **Frontend:** cost meter widget in the session header (live-updating via the same event stream — cost is just another field on events you're already rendering); an org-level budget dashboard

### 1.9 Unified Tool Mesh (Phase 1 launch item)
- **Data model:**
```sql
create table connected_tools (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  tool_name text not null,     -- "github", "notion", "linear", "slack"
  auth_config jsonb not null,  -- encrypted credentials/tokens
  status text default 'active'
);

create table agent_tool_permissions (
  agent_id uuid,               -- see Agent Fleet in Phase 2 for the agents table
  tool_id uuid references connected_tools(id),
  permission text not null     -- allowed | restricted | requires_checkpoint
);
```
- **Backend:** OAuth/token-based connectors per tool (GitHub, Notion, Linear, Slack — build one at a time, GitHub first since your ICP is eng teams), a permission check before every tool invocation in the agent loop (cross-reference `agent_tool_permissions`; `requires_checkpoint` routes through the checkpoint system in 1.3)
- **Frontend:** Tool Mesh panel (org settings) listing connected tools and per-agent permission toggles

### 1.10 Incident / Architecture Canvas (Phase 1 launch item)
- **Data model:** `session_template text` column on `sessions` (e.g. `'incident_response'`, `'architecture_decision'`, `null` for generic). Template defines which UI renders and can pre-seed the event log with a structured first event (e.g. "impacted services" field).
- **Backend:** template registry (a simple config object, not a database table, for v1 — you'll only have 2-3 templates) that defines the extra fields a session of that type captures
- **Frontend:** two purpose-built session views (`IncidentSessionView`, `ArchitectureSessionView`) that render the same underlying event log but with extra structured panels (impacted services list, mitigation checklist) layered on top

**Phase 1 fully covers:** original Features 1, 2, 3, 4, 6, 8, plus Cost Meter, Tool Mesh, and Incident/Architecture Canvas. That's everything the document calls "Phase 1 launch" material, complete.

---

# PHASE 2 — Expansion (Months 3-5)

Goal: the platform becomes something teams route their *default* AI work through, not just a subset of it.

### 2.1 Team AI Memory (Feature 5)
- **Data model:**
```sql
create table memory_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  scope text not null,           -- company | team | project | personal
  scope_id uuid,                 -- team_id/project_id/user_id depending on scope
  fact text not null,
  embedding vector(1536),        -- pgvector
  source_session_id uuid references sessions(id),
  source_event_seq int,          -- exact event this was extracted from, for citation
  status text default 'pending', -- pending | curated | rejected
  created_at timestamptz default now()
);
create index on memory_facts using ivfflat (embedding vector_cosine_ops);
```
- **Backend:** an extraction job that runs after sessions complete (or periodically on long-running ones) — LLM call over new events, extracts candidate facts, writes as `pending`; a retrieval function that embeds the current session's context and pulls top-k relevant `curated` facts scoped correctly (personal < project < team < company, don't leak across orgs ever); a curation endpoint (approve/reject pending facts)
- **Frontend:** memory panel showing what's been recalled into the current session with citations back to source sessions; a curation queue (org settings) for reviewing pending facts before they become authoritative

### 2.2 Cross-Organization Collaboration + Guest Access (Feature 7)
- **Data model:**
```sql
alter table session_members add column is_guest boolean default false;
alter table session_members add column guest_org_name text; -- external org, no real account
create table guest_invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id),
  token text unique not null,     -- magic link
  role text not null,             -- typically 'observer' or 'reviewer' for guests
  expires_at timestamptz not null,
  created_by uuid references users(id)
);
```
- **Backend:** invite generation endpoint, magic-link auth flow that creates a scoped guest session (no full account, token-based, expires), session segmentation flag (`sessions.visibility`: `internal_only` | `client_facing`) so internal sessions never show up in a guest's session list even if they're in the same org
- **Frontend:** "Invite guest" flow generating a shareable link with a role picker; a visibly different UI treatment for guest-visible sessions so internal teams know what's client-facing

### 2.3 Delegation Chains + AI Chief of Staff / Manager Agent (Feature 9 + the "Dynamic Role Allocation" item, merged — they're the same mechanism)
- **Data model:**
```sql
create table task_graphs (
  id uuid primary key default gen_random_uuid(),
  parent_session_id uuid references sessions(id), -- the session where the goal was stated
  goal text not null,
  status text default 'planning'
);
create table task_nodes (
  id uuid primary key default gen_random_uuid(),
  task_graph_id uuid references task_graphs(id),
  assigned_to_type text not null,  -- agent | human
  assigned_to_id uuid,             -- agent_id or user_id
  child_session_id uuid references sessions(id), -- each node runs as its own session
  depends_on uuid[],               -- other task_node ids that must complete first
  status text default 'pending'
);
```
- **Backend:** a "Manager Agent" workflow (built on the same durable-execution engine, Temporal/Inngest, as checkpoints) that: (1) takes a stated goal, calls the model to decompose it into a task graph, (2) creates a `session` per node, assigning the right specialized agent or flagging for human assignment, (3) watches for node completion and unblocks dependent nodes, (4) on all nodes complete, runs a synthesis step that summarizes results back into the parent session. The "Chief of Staff" recall behavior (surfacing past decisions/rejections) is the same mechanism as 2.1's memory retrieval, scoped to the task graph's context — not a separate system.
- **Frontend:** task graph visualization (a simple DAG view — nodes as cards, edges as dependency lines) in the parent session; drill into any node to see its child session

### 2.4 Agent Fleet Control Plane
- **Data model:**
```sql
create table agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  name text not null,
  version text not null,
  model_provider text not null,   -- anthropic | openai | google | custom
  model_id text not null,
  system_prompt text,
  owner_id uuid references users(id),
  status text default 'active',
  created_at timestamptz default now()
);
create table agent_runs (
  agent_id uuid references agents(id),
  session_id uuid references sessions(id),
  started_at timestamptz,
  completed_at timestamptz,
  outcome text -- success | failure | escalated
);
```
- **Backend:** agent registry CRUD, a metrics rollup job (fail-rate, avg cost, avg duration per agent from `agent_runs` + the cost data in 1.8)
- **Frontend:** Agent Fleet dashboard — list of agents with version, owner, last-used, performance metrics; this is where 1.9's Tool Mesh permissions get attached per-agent instead of being global

### 2.5 Cross-Tool Context Spine
- **Data model:** extends `connected_tools` from 1.9 — this is the *usage* of those connections, not new connections
- **Backend:** a context-fetch step added to session creation for templated sessions (2.6/1.10): given a session template and its subject (e.g. an incident ID), query connected GitHub/Linear/Notion for related PRs, tickets, docs, and inject as an initial context event before the agent starts
- **Frontend:** a "Related context" panel showing what was auto-surfaced, with links back to source

### 2.6 Pattern Library
- **Data model:**
```sql
create table workflow_patterns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  name text not null,               -- "Research → Draft → Review → Legal → Final"
  steps jsonb not null,             -- ordered list of {agent_id or role, checkpoint_policy_id}
  created_from_session_id uuid references sessions(id), -- if extracted from a real session
  is_public boolean default false
);
```
- **Backend:** "spin up from pattern" endpoint — creates a new session pre-wired with the pattern's sequence of agent/human/checkpoint steps as a scaffold
- **Frontend:** pattern library browser (org-scoped), "New session from pattern" flow
- **Relationship to Playbooks (2.8 below):** a pattern is a *template you start from*; a playbook is *extracted from a specific successful session after the fact*. They share the `workflow_patterns` table — a playbook extraction just populates `created_from_session_id` and derives `steps` from that session's actual event sequence instead of a human authoring it directly.

### 2.7 Session Intelligence & Analytics (Feature 10) — base version
- **Backend:** aggregation queries over `session_events`, `agent_runs`, `checkpoint_policies`/resolutions: session volume, checkpoint approval rate, intervention frequency (how often a human takes control from an agent), cost per session (from 1.8)
- **Frontend:** an analytics dashboard (org settings) — this is the *reporting* version; Phase 3 adds *recommendations* on top

### 2.8 Session Replay & Playbooks — the playbook half (Feature 8, part 2)
- **Backend:** "Make this repeatable" action on a completed session — extracts the session's event sequence into a `workflow_patterns` row (see 2.6), inferring the agent/checkpoint sequence automatically via an LLM pass over the event log
- **Frontend:** the extraction action lives on the session view; extracted playbooks show up in the same Pattern Library UI from 2.6

**Phase 2 fully covers:** Features 5, 7, 9, the base version of 10, plus Agent Fleet, Context Spine, Pattern Library, and the playbook-extraction half of Feature 8.

---

# PHASE 3 — Deep Moat (Months 6-9+)

Goal: hard to rip out. This is where the product stops being a tool and becomes infrastructure the org's decisions run through.

### 3.1 Compliance Vault + Regulated AI Rail
- **Data model:**
```sql
create table compliance_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  framework text not null,        -- eu_ai_act | soc2 | hipaa | custom
  rules jsonb not null,           -- structured rule set, framework-specific
  active boolean default true
);
create table compliance_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id),
  event_seq int,                  -- links back to session_events
  policy_id uuid references compliance_policies(id),
  action_taken text not null,     -- logged | blocked | escalated
  pii_detected boolean default false,
  created_at timestamptz default now()
);
```
- **Backend:** this is built *on top of* the checkpoint policy engine from 1.3 — compliance rules are a specialized, framework-templated version of `checkpoint_policies`, plus a PII-detection pass (a classifier call, or a dedicated PII-detection API) run on every event before it's persisted. Since `session_events` is already your full audit trail, the Compliance Vault is largely a curated *view* over it (`compliance_events`) plus enforcement, not a parallel logging system.
- **Frontend:** compliance dashboard per framework, exportable audit reports, a policy template picker (pre-built EU AI Act/SOC2/HIPAA rule sets an org can adopt and customize)

### 3.2 Organizational Memory Graph + "Ask the Company"
- **Data model:** this extends 2.1's `memory_facts` into an actual graph:
```sql
create table graph_nodes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  node_type text not null,  -- decision | project | person | customer | incident | principle | agent | workflow
  ref_id uuid,              -- points to the underlying row (session id, user id, etc.) where applicable
  label text not null
);
create table graph_edges (
  from_node uuid references graph_nodes(id),
  to_node uuid references graph_nodes(id),
  edge_type text not null   -- decided_by | blocked_by | related_to | approved_by | caused_incident
);
```
- **Backend:** nodes/edges are populated incrementally as a side effect of normal activity (a `checkpoint_resolved` event with `approved` creates an `approved_by` edge; a branch rejection creates a node with the rejected reasoning attached) rather than a separate authoring step — build the extraction as hooks on existing event types, not a new manual system. "Ask the Company" is a retrieval-augmented query: embed the question, do a hybrid search across `memory_facts` (2.1) and graph traversal from matched nodes, synthesize an answer with citations back to source sessions.
- **Frontend:** a graph visualization view (nodes/edges, filterable by type) and the "Ask the Company" search box with cited answers

### 3.3 AI Outcomes Analytics (Feature 10, full version)
- **Backend:** extends 2.7 with pattern detection — a scheduled job that looks for statistically frequent failure points (e.g. a specific tool consistently preceding `agent_run.outcome = 'failure'`) and generates recommendation records:
```sql
create table analytics_recommendations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  finding text not null,
  evidence jsonb,        -- session/event ids backing the finding
  status text default 'new' -- new | acknowledged | dismissed
);
```
- **Frontend:** recommendations feed on the analytics dashboard from 2.7, each linking to the evidence sessions

### 3.4 Cross-Org AI Graph (Partner/Client Network)
- **Data model:** extends 2.2's guest/cross-org tables with an aggregation layer:
```sql
create table partner_benchmarks (
  id uuid primary key default gen_random_uuid(),
  workflow_pattern_id uuid references workflow_patterns(id),
  org_id uuid references orgs(id),
  metric_name text not null,     -- e.g. "review_cycle_time_hours"
  metric_value numeric,
  period date
);
```
Anonymized/aggregated — never expose one org's raw numbers to another directly; only cohort percentiles.
- **Backend:** a rollup job across orgs that share a common `workflow_pattern_id` (from 2.6), computing anonymized percentile benchmarks
- **Frontend:** "Partner Insights" panel — "your review workflow is in the 40th percentile for cycle time" — only shown where enough orgs share the pattern to anonymize safely (enforce a minimum cohort size, e.g. 5+ orgs, before showing any benchmark)

### 3.5 Marketplace (Playbooks / Agents)
- **Data model:**
```sql
alter table workflow_patterns add column marketplace_listing boolean default false;
alter table agents add column marketplace_listing boolean default false;
create table marketplace_installs (
  id uuid primary key default gen_random_uuid(),
  listing_type text not null, -- pattern | agent
  listing_id uuid not null,
  installed_by_org uuid references orgs(id),
  installed_at timestamptz default now()
);
```
- **Backend:** publish flow (an org opts a `workflow_pattern` or `agent` into `marketplace_listing = true`, after a review step you'll want to gate manually at first), install flow (copies the pattern/agent config into the installing org's own tables — don't let installed items stay live-linked to the publisher, or you've built a supply-chain risk)
- **Frontend:** marketplace browse/search page, publish flow for org admins, install button

### 3.6 Heavy RBAC Matrix + Custom Roles
- **Data model:**
```sql
create table custom_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  name text not null,
  permissions jsonb not null -- e.g. {"can_approve_checkpoints": true, "can_branch": false, ...}
);
alter table session_members alter column role type text; -- now references custom_roles.id when org has custom roles, falls back to the built-in enum otherwise
```
- **Backend:** replace the hard-coded role-check middleware from 1.2 with a permission-lookup (built-in roles become default `custom_roles` rows seeded per org, so there's one code path, not two)
- **Frontend:** role editor in org settings — checkbox matrix of permissions per custom role

**Phase 3 fully covers:** Compliance Vault, the full Org Memory Graph + Ask the Company, full Analytics with recommendations, Cross-Org AI Graph, Marketplace, and the custom RBAC matrix.

---

# Complete Feature Coverage Checklist

Every item from the source document, and where it's now specified:

| Feature | Phase | Section |
|---|---|---|
| 1. Live Co-Piloting | 1 | 1.1 |
| 2. Async Session Threads | 1 | 1.5 |
| 3. Divergent Exploration / Branching | 1 | 1.4 |
| 4. Checkpoint System | 1 | 1.3 |
| 5. Team AI Memory | 2 | 2.1 |
| 6. Role-Based Participation | 1 | 1.2 |
| 7. Cross-Org Collaboration | 2 | 2.2 |
| 8. Session Replay & Playbooks | 1 + 2 | 1.6, 2.8 |
| 9. Delegation Chains | 2 | 2.3 |
| 10. Session Intelligence & Analytics | 2 + 3 | 2.7, 3.3 |
| Session Timeline / Time-Travel | 1 | 1.7 (= 1.6) |
| Outcome Cost Meter | 1 | 1.8 |
| Unified Tool Mesh | 1 | 1.9 |
| Incident/Architecture Canvas | 1 | 1.10 |
| Agent Fleet Control Plane | 2 | 2.4 |
| Dynamic Role Allocation / Manager Agent | 2 | 2.3 (merged) |
| Cross-Tool Context Spine | 2 | 2.5 |
| Pattern Library | 2 | 2.6 |
| Compliance Vault | 3 | 3.1 |
| Org Memory Graph + Ask the Company | 3 | 3.2 |
| AI Outcomes Analytics (recommendations) | 3 | 3.3 |
| Cross-Org AI Graph | 3 | 3.4 |
| Marketplace | 3 | 3.5 |
| Heavy RBAC Matrix | 3 | 3.6 |
| AI Chief of Staff | 2 | 2.3 (merged) |
| No-Account Guest Access | 2 | 2.2 (merged) |

Nothing from the document is unaccounted for.
