# Multiplayer AI — Development Flow (Complete, All Phases)

This is the exact, numbered build order — database, then backend, then frontend, at each phase — covering all 24 features from `multiplayer-ai-complete-spec.md`. This version supersedes the earlier 8-week-only draft. Read `multiplayer-ai-technical-buildguide.md` alongside this for the *why* behind the ordering; this file is the *what, in what order*.

**The rule that doesn't change across any phase:** database schema before backend, backend before frontend, and within each phase, the core mechanism working single-player/single-org before the multiplayer/governed/cross-org version of it. This is true in Phase 1 (single-agent chat before multiplayer) and stays true in Phase 2 and 3 (one org's memory before cross-org graph; one policy type before the full compliance framework).

---

## Phase 0 — Project Setup (Day 1)

1. `npx create-next-app` — TypeScript, App Router, Tailwind
2. Supabase or Neon project (Postgres)
3. Drizzle ORM (or Prisma) for schema-as-code
4. Push repo, connect Vercel for auto-deploy on push
5. Clerk for auth — use their pre-built components, don't build a login page

---

## PHASE 1 — Core Platform (Weeks 1-8)

### Step 1 — Database: foundational tables (Day 1-2)

Build exactly these 5 tables — full DDL is in `multiplayer-ai-technical-buildguide.md` Section 2:
- `orgs`
- `users`
- `sessions` (include `session_template`, `visibility`, `parent_session_id`, `forked_from_event_seq` columns now, even though branching/templates come later — cheaper to add the columns once than to migrate twice)
- `session_members` (include `is_guest`, `guest_org_name` columns now — same reasoning)
- `session_events` (include `token_usage`, `cost_usd` columns now)

Enable Row-Level Security on all three org-scoped tables now, even though you won't have cross-org data yet — retrofitting RLS onto live data later is painful.

### Step 2 — Backend: session CRUD (Day 2-3)
- `POST /api/sessions` — create, insert creator as `owner` in `session_members`
- `GET /api/sessions` — list for current user's org
- `GET /api/sessions/:id` — detail + membership check

### Step 3 — Backend: event log read/write (Day 3-4)
- `POST /api/sessions/:id/events` — append event, role-checked
- `GET /api/sessions/:id/events?since=N` — fetch for initial load / reconnect

### Step 4 — Backend: single-agent AI loop (Day 4-6)
- On `user_message` append, trigger a handler: fetch event history, call Claude via Vercel AI SDK, write `agent_message` event(s) back
- No multiplayer, no sockets yet — verify one human talking to one agent works completely before adding anything else

### Step 5 — Frontend: auth + session list (Day 2, parallel with Step 2)
- Clerk sign-in
- `/sessions` list page, "New Session" button

### Step 6 — Frontend: single session view, static (Day 4-5)
- `/sessions/[id]`: fetch events, render as a simple chat list
- Input box posts `user_message`, refetches (no sockets yet)

### Step 7 — Frontend: streaming responses (Day 5-6)
- Switch to consuming the AI SDK's streaming hooks directly instead of refetch-after-send

### Step 8 — Real-time fan-out — Feature 1.1 (Week 3)
- **Backend:** Redis pub/sub on every `session_events` insert -> channel `session:{id}`; WebSocket gateway (or Ably) subscribes clients per session
- **Backend:** `suggestion` event type — non-pilot posts a suggested message; pilot can accept (re-posts as `user_message`) or dismiss
- **Frontend:** Liveblocks presence/cursors; subscribe to live channel, append incoming events to the TanStack Query cache (don't refetch the whole list)

### Step 9 — Role enforcement — Feature 1.2 (Week 3, same time as Step 8)
- **Backend:** middleware checking `session_members.role` before allowing writes — **build this as a single choke-point function all mutating requests pass through.** This is the piece that makes the Phase 3 RBAC generalization (Feature 3.6) cheap instead of a rewrite.
- **Backend:** `POST /api/sessions/:id/take-control` — updates active pilot, broadcasts `role_change`
- **Frontend:** role badges, permission-gated controls

### Step 10 — Checkpoint system — Feature 1.3 (Week 4)
- **Database:** add `checkpoint_policies` table (full DDL in `multiplayer-ai-complete-spec.md` Section 1.3)
- **Backend:** policy evaluator — a plain function run as a step before every agent action, checking active policies against `trigger_config`. **This evaluator is the seed of the Phase 3 Governance Layer** (compliance policies and custom roles will extend its vocabulary, not replace it — see the build guide Section 3.4)
- **Backend:** `POST /api/sessions/:id/checkpoints/:eventId/resolve`
- **Backend:** wire policy pause/resume through Inngest/Trigger.dev's "wait for external signal" pattern
- **Frontend:** checkpoint card (Approve/Reject), a basic policy management page

### Step 11 — Branching — Feature 1.4 (Week 5-6)
- **Database:** add `branch_merges` table
- **Backend:** `POST /api/sessions/:id/branch` (fork at event N, no event copying — branch reads walk up to parent for events `<= forked_from_event_seq`); merge endpoint (human-authored summary, records rejected alternatives)
- **Frontend:** "Branch from here," side-by-side compare, merge action

### Step 12 — Async handoff — Feature 1.5 (Week 7)
- **Backend:** `handoff_brief` event type; scheduled/on-demand LLM summary job over events since last handoff
- **Backend:** pending-decisions query (unresolved `checkpoint_raised` events)
- **Frontend:** handoff brief card, pending-decisions panel

### Step 13 — Cost meter — Feature 1.8 (Week 7, parallel with Step 12)
- **Database:** add `budget_limits` table
- **Backend:** cost aggregation endpoint (`sum(cost_usd)` per session); scheduled job checking org spend against `budget_limits`, alert/soft-lock at threshold
- **Frontend:** live cost meter in session header, org budget dashboard

### Step 14 — Tool Mesh — Feature 1.9 (Week 7-8)
- **Database:** add `connected_tools`, `agent_tool_permissions` tables
- **Backend:** OAuth connector for GitHub first (your ICP is eng teams); permission check before tool invocation, routing through the Step 10 policy evaluator when a tool requires a checkpoint. Consider MCP servers for GitHub/Slack/Notion instead of hand-rolling connectors.
- **Frontend:** Tool Mesh panel in org settings

### Step 15 — Session templates — Feature 1.10 (Week 8)
- **Backend:** template registry (config object, not a table, for 2-3 templates); template-specific structured first event
- **Frontend:** `IncidentSessionView`, `ArchitectureSessionView` — same underlying event log, extra structured panels layered on top

### Step 16 — Timeline / replay — Features 1.6, 1.7 (Week 8)
- **Frontend only** — no new backend. Scrubber over the existing event log, replay by reconstructing state at events 0..N, jump-to-moment. Free, because Step 1's schema was built for this.

**Phase 1 complete when:** one org can run a multiplayer, role-governed, checkpointed, branchable, cost-tracked session with tool access and a replayable timeline. This is the full MVP — ship it and get real usage before Phase 2.

---

## PHASE 2 — Expansion (Months 3-5)

Order these by dependency, not strictly by number — 2.4 (Agent Fleet) is a light prerequisite for 2.3 (Delegation Chains) since task nodes need agents to assign to.

### Step 17 — Agent Fleet — Feature 2.4
- **Database:** `agents`, `agent_runs` tables
- **Backend:** agent registry CRUD; metrics rollup from `agent_runs` + Phase 1's cost data
- **Frontend:** Agent Fleet dashboard

### Step 18 — Team AI Memory — Feature 2.1
- **Database:** `memory_facts` table with `pgvector` embedding column
- **Backend:** extraction job (post-session or periodic, LLM call over new events -> candidate facts, written as `pending`); scoped retrieval function (personal < project < team < company); curation endpoint
- **Frontend:** memory panel with citations, curation queue

### Step 19 — Delegation Chains / Manager Agent — Feature 2.3
- **Database:** `task_graphs`, `task_nodes` tables
- **Backend:** Manager Agent workflow on Temporal (migrate from Inngest/Trigger.dev here — this is the point where the durable-execution engine upgrade earns its cost, per the build guide Section 3.2): goal -> decomposition -> per-node sessions -> dependency tracking -> synthesis. "Chief of Staff" recall uses Step 18's memory retrieval scoped to the task graph — same mechanism, not new infrastructure.
- **Frontend:** task graph DAG view, drill into node sessions

### Step 20 — Cross-Org Collaboration + Guest Access — Feature 2.2
- **Database:** `guest_invites` table (columns for `is_guest`/`guest_org_name`/`visibility` already exist from Phase 1 Step 1)
- **Backend:** invite generation, magic-link guest auth (fully separate from Clerk's normal auth), session segmentation enforcement (`internal_only` sessions never visible to guests)
- **Frontend:** invite flow with role picker, visual distinction for client-facing sessions

### Step 21 — Context Spine — Feature 2.5
- **Backend:** extends Step 14's `connected_tools` — a context-fetch step at session creation for templated sessions (Step 15), querying connected tools for related items, injected as an initial context event
- **Frontend:** "Related context" panel with source links

### Step 22 — Pattern Library — Feature 2.6
- **Database:** `workflow_patterns` table
- **Backend:** "spin up from pattern" endpoint, pre-wiring a new session's agent/checkpoint scaffold
- **Frontend:** pattern library browser, "New session from pattern"

### Step 23 — Playbook extraction — Feature 2.8 (completes Feature 8 from the original spec)
- **Backend:** "Make this repeatable" action — LLM pass over a completed session's event log, populates a `workflow_patterns` row automatically
- **Frontend:** extraction action on the session view; results appear in Step 22's library UI

### Step 24 — Session Intelligence & Analytics (base) — Feature 2.7
- **Backend:** aggregation queries over `session_events`, `agent_runs`, checkpoint resolutions
- **Frontend:** analytics dashboard (org settings)

**Phase 2 complete when:** the platform has memory across sessions, can decompose and delegate goals across agents/humans, supports external guests safely, and teams can turn successful sessions into reusable patterns.

---

## PHASE 3 — Deep Moat (Months 6-9+)

### Step 25 — Compliance Vault — Feature 3.1
- **Database:** `compliance_policies`, `compliance_events` tables
- **Backend:** extends Step 10's policy evaluator with framework-templated rules (EU AI Act/SOC2/HIPAA) + a PII-detection pass on events before persistence. `compliance_events` is a curated view over `session_events`, not a parallel log.
- **Frontend:** compliance dashboard per framework, exportable audit reports, policy template picker

### Step 26 — Org Memory Graph + "Ask the Company" — Feature 3.2
- **Database:** `graph_nodes`, `graph_edges` tables
- **Backend:** nodes/edges populated incrementally as hooks on existing event types (a `checkpoint_resolved` approval creates an `approved_by` edge); "Ask the Company" as hybrid retrieval (Step 18's vector search + full-text + graph traversal) synthesized with citations
- **Frontend:** graph visualization, "Ask the Company" search bar with cited answers

### Step 27 — AI Outcomes Analytics (full) — Feature 3.3
- **Database:** `analytics_recommendations` table
- **Backend:** scheduled pattern-detection job over Step 24's data, generating findings with evidence links
- **Frontend:** recommendations feed on the Step 24 dashboard

### Step 28 — Cross-Org AI Graph / Partner Insights — Feature 3.4 (per spec numbering)
- **Database:** `partner_benchmarks` table, extending Step 20's cross-org tables
- **Backend:** anonymized rollup across orgs sharing a `workflow_pattern_id` (Step 22), minimum cohort size enforced before showing any benchmark
- **Frontend:** "Partner Insights" panel

### Step 29 — Marketplace — Feature 3.5
- **Database:** `marketplace_listing` flags on `workflow_patterns`/`agents`, `marketplace_installs` table
- **Backend:** publish flow (manually gated review to start), install flow (copies config into installing org — never a live cross-org reference)
- **Frontend:** marketplace browse/search, publish flow, install button

### Step 30 — Heavy RBAC Matrix — Feature 3.6
- **Database:** `custom_roles` table with a `permissions jsonb` matrix
- **Backend:** replace Step 9's enum check with a permission-key lookup against `custom_roles` — this is a small refactor specifically *because* Step 9 was built as a single choke-point function
- **Frontend:** role editor (permission checkbox matrix) in org settings

**Phase 3 complete when:** every feature in `multiplayer-ai-complete-spec.md` is built. All 24 features, all 3 phases, nothing skipped.

---

## Complete Step Index

| Step | Feature | Phase |
|---|---|---|
| 1-7 | Foundational schema + single-player loop | 1 (setup) |
| 8 | 1.1 Live Co-Piloting | 1 |
| 9 | 1.2 Role-Based Participation | 1 |
| 10 | 1.3 Checkpoint System | 1 |
| 11 | 1.4 Branching | 1 |
| 12 | 1.5 Async Session Threads | 1 |
| 13 | 1.8 Outcome Cost Meter | 1 |
| 14 | 1.9 Unified Tool Mesh | 1 |
| 15 | 1.10 Incident/Architecture Canvas | 1 |
| 16 | 1.6/1.7 Session Timeline/Replay | 1 |
| 17 | 2.4 Agent Fleet Control Plane | 2 |
| 18 | 2.1 Team AI Memory | 2 |
| 19 | 2.3 Delegation Chains / Manager Agent | 2 |
| 20 | 2.2 Cross-Org Collaboration / Guest Access | 2 |
| 21 | 2.5 Context Spine | 2 |
| 22 | 2.6 Pattern Library | 2 |
| 23 | 2.8 Playbook Extraction | 2 |
| 24 | 2.7 Session Intelligence & Analytics (base) | 2 |
| 25 | 3.1 Compliance Vault | 3 |
| 26 | 3.2 Org Memory Graph + Ask the Company | 3 |
| 27 | 3.3 AI Outcomes Analytics (full) | 3 |
| 28 | 3.4 Cross-Org AI Graph | 3 |
| 29 | 3.5 Marketplace | 3 |
| 30 | 3.6 Heavy RBAC Matrix | 3 |

All 24 features from `multiplayer-ai-complete-spec.md` are covered, with none skipped.
