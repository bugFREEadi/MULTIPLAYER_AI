# Multiplayer AI — Complete Technical Architecture Guide

This is the full-stack architecture for everything in the spec — every subsystem needed to support all 3 phases, all ~24 features. It's organized by *technical subsystem* rather than by feature, because several features share the same underlying infrastructure (e.g. Team Memory, Org Memory Graph, and "Ask the Company" are all one retrieval subsystem; Checkpoints, Compliance Vault, and the RBAC Matrix are all one policy-enforcement subsystem). Each section says what it needs to do, what to build vs. buy, and which phase it belongs to.

---

## System Overview

Four architectural layers, built in this order because each depends on the one below it:

```
┌─────────────────────────────────────────────────────┐
│  4. INTELLIGENCE LAYER                               │
│     Memory/Graph · Analytics · Recommendations       │
│     · "Ask the Company" search                       │  Phase 2-3
├─────────────────────────────────────────────────────┤
│  3. GOVERNANCE LAYER                                  │
│     Policy engine (checkpoints/compliance/RBAC)       │  Phase 1 (core),
│     · Cost tracking · Audit trail                      │  Phase 3 (full)
├─────────────────────────────────────────────────────┤
│  2. ORCHESTRATION LAYER                                │
│     Durable execution · Multi-agent/multi-model        │  Phase 1-2
│     · Task graphs · Tool integrations                  │
├─────────────────────────────────────────────────────┤
│  1. COLLABORATION LAYER                                │
│     Event-sourced session log · Real-time fan-out       │  Phase 1
│     · Presence · Roles · Branching                       │
└─────────────────────────────────────────────────────┘
```

Everything above Layer 1 reads and writes through the same event log — there is no separate database for "governance data" vs. "collaboration data." This is the single most important architectural discipline to hold onto as scope grows: resist the urge to spin up a parallel system for each new feature area. Extend the event log's vocabulary (new `event_type`s) and add narrowly-scoped tables that reference it, rather than building silos.

---

## 1. Collaboration Layer (Phase 1)

Already specified in detail in prior docs. Summary of the stack:

| Concern | Stack |
|---|---|
| Source of truth | Postgres, `session_events` append-only log |
| Real-time fan-out | Redis Pub/Sub → WebSocket gateway (or Ably/Liveblocks managed) |
| Presence/cursors | Liveblocks |
| Branching | Same table, `parent_session_id` + `forked_from_event_seq`, no data duplication |

No changes needed here as later phases build on top — this layer should stay stable once Phase 1 ships. If you find yourself wanting to modify `session_events`' shape in Phase 2 or 3, that's a signal to add a new `event_type` or a satellite table, not to alter the core log.

---

## 2. Orchestration Layer (Phase 1-2)

**What it must do:** run AI work — single agent, multi-agent, long-running, pausable, resumable, multi-model, tool-calling, and (Phase 2) decomposed into dependent sub-tasks distributed across agents and humans.

### 2.1 Durable execution engine
- **Build vs. buy:** buy. This is not your differentiator — the checkpoint/branch/governance model built *on top of* durable execution is.
- **Phase 1:** Inngest or Trigger.dev — fast to integrate, sufficient for pause/resume on checkpoints and scheduled handoff jobs.
- **Phase 2+:** migrate the core agent-run workflow to **Temporal** once you have: (a) delegation chains with multi-node dependency graphs, (b) enough volume that Inngest/Trigger.dev's pricing model stops making sense, or (c) enterprise customers asking about execution guarantees. Temporal's workflow-as-code model maps directly onto `task_graphs`/`task_nodes` from the spec — each `task_node` becomes a Temporal child workflow, with `depends_on` expressed as workflow signals.

### 2.2 Model abstraction ("Bring your AI")
- **Stack:** Vercel AI SDK (TypeScript) or LiteLLM (Python) as the provider-agnostic call layer, supporting Anthropic, OpenAI, Google, and self-hosted/open-source models behind one interface.
- **Where model choice is stored:** the `agents` table (Phase 2, Agent Fleet) holds `model_provider`/`model_id` per agent — the orchestration layer reads this at run time rather than hard-coding a model anywhere in application code.

### 2.3 Multi-agent coordination
- **Phase 1:** one agent per session, tool-calling loop via the model SDK directly — no framework needed yet.
- **Phase 2:** once you build Delegation Chains / the Manager Agent, introduce **LangGraph** (Python) or an equivalent state-machine library *only for the Manager Agent's planning step* — the goal-decomposition-into-task-graph logic genuinely benefits from a graph-based agent framework. Don't rewrite the simple single-agent sessions to use it; keep that path lean.

### 2.4 Tool integrations (Tool Mesh + Context Spine)
- **Stack:** OAuth2 flows per connected tool, credentials encrypted at rest (use your cloud provider's KMS, e.g. AWS KMS or equivalent via Supabase Vault). Build connectors incrementally: GitHub first (your ICP is eng teams), then Linear, then Notion, then Slack.
- **Consider MCP (Model Context Protocol)** as the connector standard rather than hand-rolling a bespoke integration per tool — several of these (GitHub, Slack, Notion) already have community or official MCP servers you can adopt directly instead of writing OAuth + API wrapper code yourself. This significantly cuts Phase 1.9/2.5 build time.
- **Context Spine (2.5):** a fetch-and-inject step at session creation time for templated sessions — not a permanently-running sync process in Phase 2 (that's a Phase 3+ concern if you ever need live-updating context rather than fetch-at-creation).

---

## 3. Governance Layer (Phase 1 core, Phase 3 full)

**What it must do:** enforce checkpoints, evaluate compliance policies, control permissions, track cost — and produce an audit trail for all of it. Treat this as *one policy-enforcement engine* used four ways, not four separate systems.

### 3.1 The policy engine (single subsystem, multiple consumers)
```
checkpoint_policies  →  general-purpose "pause and require approval" rules      (Phase 1)
compliance_policies  →  framework-templated policies (EU AI Act, SOC2, HIPAA)   (Phase 3)
custom_roles         →  permission matrices per org                            (Phase 3)
```
All three are evaluated by the same runtime component: a policy evaluator that runs before every agent action (message, tool call) and checks active rules for the org. Build this evaluator once in Phase 1 for checkpoints; extend its rule vocabulary in Phase 3 rather than building a separate compliance-specific evaluator. This is the highest-leverage piece of engineering discipline in the whole platform — a second, parallel rules engine for compliance would be a real architectural mistake.

- **Stack:** the policy evaluator can be a plain TypeScript/Python function evaluated inside the orchestration workflow (Inngest/Temporal step) — you do not need a dedicated rules-engine product (e.g. OPA/Open Policy Agent) until policy complexity genuinely outgrows readable `if` logic over `trigger_config` JSON. Revisit this only if Phase 3 compliance policies get complex enough that non-engineers (compliance officers) need to author them — at that point, OPA or a similar DSL becomes worth the integration cost.

### 3.2 Cost tracking
- **Stack:** capture token usage + cost from every model provider response (all major SDKs return this), write to `session_events`/`agent_runs` as specified. Aggregate with straightforward SQL rollups (Postgres materialized views refreshed periodically are enough — you don't need a time-series database like ClickHouse until analytics volume is very high, which is a Phase 3+ concern at earliest).

### 3.3 Audit trail
- The event log **is** the audit trail (Layer 1). The `compliance_events` table (Phase 3) is a filtered, framework-annotated view over it — not a parallel logging pipeline. Compliance reporting/export is a query + PDF/CSV export job, not new infrastructure.

### 3.4 RBAC
- **Phase 1:** hard-coded 6-role enum, checked in middleware.
- **Phase 3:** generalize to `custom_roles` with a permissions JSON matrix; the middleware changes from "check enum value" to "check permission key in role's JSON," which is a small refactor if you designed the Phase 1 middleware as a single choke point (one function all writes go through) rather than scattered checks — enforce that discipline in Phase 1 specifically so Phase 3 is cheap.

---

## 4. Intelligence Layer (Phase 2-3)

**What it must do:** remember things across sessions (Team Memory), connect them into a queryable structure (Org Memory Graph), answer natural-language questions over that structure ("Ask the Company"), and surface patterns/recommendations (Analytics).

### 4.1 Memory & retrieval infrastructure
- **Vector search:** **pgvector** on the same Postgres instance. Do not stand up a dedicated vector database (Pinecone, Weaviate, Qdrant) — pgvector with an IVFFlat or HNSW index handles retrieval at real scale (millions of facts) and keeps you on one database, which matters enormously for a small team's operational burden.
- **Embedding model:** any current-generation embedding API (OpenAI's or a comparable provider) called at fact-extraction time and query time — this is a stateless API call, not infrastructure you run.
- **Extraction pipeline:** an async job (Inngest, same engine as everything else) triggered on session completion or periodically on long-running sessions, calling an LLM to extract candidate facts from new events since the last extraction run.

### 4.2 Graph layer (Org Memory Graph)
- **Build vs. buy:** build on Postgres (`graph_nodes`/`graph_edges` tables as specified), **do not** introduce a dedicated graph database (Neo4j, etc.) for Phase 2-3. A relational adjacency-list model handles the query patterns described in the spec ("what's related to X," "what decided Y") via recursive CTEs, and again keeps your operational surface to one database. Revisit only if you need genuinely deep multi-hop graph traversal at low latency at a scale where Postgres recursive CTEs become the bottleneck — unlikely before you have hundreds of enterprise customers.

### 4.3 "Ask the Company" search
- **Architecture:** hybrid retrieval — vector search over `memory_facts` (4.1) + keyword/full-text search (Postgres's built-in `tsvector` is sufficient) + graph traversal from any directly-matched nodes (4.2), merged and passed as context to an LLM call that synthesizes a cited answer. This is a retrieval-augmented generation (RAG) pattern, not a new category of infrastructure — don't over-engineer it as a separate "search service."

### 4.4 Analytics & recommendations
- **Phase 2 (reporting):** SQL aggregation queries over existing tables (`session_events`, `agent_runs`, checkpoint resolutions), exposed via a dashboard. No new infra.
- **Phase 3 (recommendations):** a scheduled analysis job that runs statistical pattern detection (e.g. "tool X precedes failure Y% of the time") over the same data and writes findings to `analytics_recommendations`. This can start as straightforward SQL + simple heuristics — resist building an ML pipeline for this until you have enough data volume and enough evidence that heuristics aren't catching what matters. A dedicated analytics/OLAP store (ClickHouse, BigQuery) only becomes worth the complexity once single-org event volume is large enough that Postgres aggregate queries are visibly slow — treat that as a scaling problem to solve when it appears, not a day-one requirement.

---

## 5. Cross-Cutting: Multi-Tenancy, Marketplace & Guest Access (Phase 2-3)

- **Multi-tenancy:** every table that holds org-scoped data has `org_id`; enforce isolation at the query layer (every query filters by the authenticated user's org) and additionally with **Postgres Row-Level Security (RLS)** policies as a second line of defense — this matters a lot once you have cross-org features (guest access, marketplace, benchmarks) where a bug in application-layer filtering could leak data across orgs. Turn RLS on from Phase 1, even though you don't need it yet — retrofitting RLS onto a live multi-tenant database is painful.
- **Guest access:** token-based, time-limited, no full account — a `guest_invites` table plus a lightweight session-scoped auth flow. Keep this fully separate from Clerk's normal user auth rather than trying to create "temporary Clerk accounts."
- **Marketplace:** installing a shared pattern/agent **copies** the config into the installing org's own tables rather than creating a live cross-org reference — this avoids a whole category of security and versioning problems (a publisher editing something that's already "installed" elsewhere shouldn't silently change other orgs' behavior).

---

## 6. Frontend Architecture (all phases)

- **Framework:** Next.js (App Router) + TypeScript, unchanged across all phases.
- **State/data:** TanStack Query for all server data (sessions, events, memory facts, analytics), Liveblocks hooks for presence, a lightweight event-merge layer that combines REST-fetched history with live WebSocket events into one ordered list — this pattern, built once in Phase 1, is reused for every new event type added in later phases (checkpoints, handoff briefs, task-graph updates) without new plumbing.
- **New UI surfaces by phase:**
  - Phase 1: session view, timeline/scrubber, checkpoint cards, branch compare, cost meter, tool mesh settings, template-specific canvases
  - Phase 2: memory panel + curation queue, guest invite flow, task graph DAG view, agent fleet dashboard, context panel, pattern library browser, analytics dashboard
  - Phase 3: compliance dashboard, org graph visualization + "Ask the Company" search bar, recommendations feed, partner insights panel, marketplace browse/publish, custom role editor
- **Component reuse discipline:** the timeline/event-list component built in Phase 1 should be the same component rendering checkpoints, memory citations, task graph updates, and compliance flags in later phases — differentiated by `event_type`-specific renderers, not by separate page architectures. This is where a lot of frontend effort gets wasted if not planned for — decide the event-renderer-registry pattern in Phase 1 even if you only have 4 event types then.

---

## 7. Backend Architecture (all phases)

- **Phase 1:** a single Next.js app (API routes + frontend together) is genuinely fine — don't split services prematurely.
- **Phase 2:** split out the durable-execution workers (Inngest/Trigger.dev functions, or Temporal workers if migrated) into their own deployable process — they have different scaling characteristics (long-running, CPU/memory variable) than your request/response API routes. This is the first real service boundary.
- **Phase 3:** consider splitting the Intelligence Layer (memory extraction, graph updates, analytics jobs) into its own worker service if job volume grows enough that it's competing for resources with orchestration workers — otherwise keep it in the same worker process as Phase 2's split. Avoid a general move to microservices; two or three well-bounded services (API, orchestration workers, intelligence workers) is enough for a very long time.

---

## 8. Data Layer (complete, all phases)

| Store | Purpose | When introduced |
|---|---|---|
| Postgres (Supabase/Neon) | Everything relational: sessions, events, users, orgs, roles, policies, agents, task graphs, memory facts, graph nodes/edges, analytics | Phase 1 |
| pgvector extension | Embeddings for memory facts and semantic search | Phase 2 |
| Redis (Upstash) | Pub/sub fan-out, job queue backing | Phase 1 |
| S3-compatible (Cloudflare R2) | Uploaded documents, exports, transcripts | Phase 1 |
| Postgres RLS | Multi-tenant isolation enforcement | Phase 1 (enabled early, relied on more from Phase 2) |

Notice there is **one relational database** carrying the entire platform through all three phases. This is a deliberate choice: it minimizes operational surface for a small team, and every "do we need X specialized database" question in this doc resolved to "no, Postgres handles it" — vector search, graph traversal, and analytics aggregation are all workloads Postgres handles well at the scale you'll be at for a long time. Revisit specialized stores only when you have concrete evidence (measured query latency, not anticipated future scale) that Postgres is the bottleneck.

---

## 9. Security & Compliance Infrastructure (Phase 1 foundation, Phase 3 depth)

- Credentials/tokens (tool connectors, guest invites) encrypted at rest from day one — don't defer this "until compliance matters," it's cheap to do correctly in Phase 1 and expensive to retrofit.
- RLS enabled from Phase 1 (see Section 5).
- SOC2 readiness (audit logging, access controls) is largely a byproduct of the event-sourced architecture plus RLS plus encrypted credentials — formal SOC2 certification is a Phase 3 business process (auditor engagement, documented policies) layered on infrastructure you'll have already built for other reasons, not a separate infrastructure buildout.

---

## 10. Staffing Implications by Phase

Being direct about this since the architecture above spans a wide range of subsystems:

- **Phase 1:** buildable solo with Cursor, as scoped in the earlier 8-week plan. This guide's Phase 1 sections describe what that plan already covers plus the 3 launch extras.
- **Phase 2:** the Manager Agent (2.3), Agent Fleet (2.4), and Memory pipeline (2.1) are each substantial enough that a solo founder building all of Phase 2 alone is a multi-month undertaking even with Cursor's help. This is the point where bringing on a second engineer (or a technical cofounder) changes your timeline the most — Phase 2 parallelizes well across two people (one on orchestration/Manager Agent, one on memory/intelligence) in a way Phase 1 doesn't.
- **Phase 3:** Compliance Vault and the Marketplace both have real non-engineering work attached (compliance framework research, marketplace review/moderation policy) — budget for that alongside the engineering.

---

## Complete Subsystem Checklist

Every feature from the spec, mapped to which architectural layer/subsystem builds it — confirming nothing is missing from this guide:

| Feature | Layer | Section |
|---|---|---|
| Live Co-Piloting | Collaboration | 1 |
| Roles (base) | Collaboration | 1 |
| Branching | Collaboration | 1 |
| Async Threads / Handoff | Orchestration | 2.1 |
| Checkpoint System | Governance | 3.1 |
| Cost Meter / Budget Guardrails | Governance | 3.2 |
| Tool Mesh | Orchestration | 2.4 |
| Incident/Architecture Canvas | Collaboration (templates) | 1 |
| Session Timeline/Replay | Collaboration | 1 |
| Team AI Memory | Intelligence | 4.1 |
| Cross-Org Collaboration / Guest Access | Cross-cutting | 5 |
| Delegation Chains / Manager Agent / Chief of Staff | Orchestration | 2.1, 2.3 |
| Agent Fleet Control Plane | Orchestration | 2.2 |
| Context Spine | Orchestration | 2.4 |
| Pattern Library / Playbooks | Collaboration + Orchestration | 1 (replay), 2.6-equivalent |
| Session Intelligence & Analytics | Intelligence | 4.4 |
| Compliance Vault | Governance | 3.1, 3.3 |
| Org Memory Graph | Intelligence | 4.2 |
| "Ask the Company" | Intelligence | 4.3 |
| AI Outcomes Analytics / Recommendations | Intelligence | 4.4 |
| Cross-Org AI Graph / Partner Insights | Cross-cutting | 5 |
| Marketplace | Cross-cutting | 5 |
| Heavy RBAC Matrix | Governance | 3.4 |

Every feature from every phase is accounted for in this architecture.
