# Multiplayer AI — Technical Build Guide (Complete, All Phases)

This is the architecture-level companion to `multiplayer-ai-development-flow.md`. That file gives the exact numbered build steps; this file explains *why* those steps are architected the way they are, and gives the core foundational schema every later phase builds on top of. Read both together. This version supersedes the earlier 8-week-only draft — it now covers every feature across Phase 1, 2, and 3, matching `multiplayer-ai-complete-spec.md` and `multiplayer-ai-complete-technical-guide.md` exactly (same feature numbers: 1.1–1.10, 2.1–2.8, 3.1–3.6 — 24 features total).

**Timeline reality:** Phase 1 (~2 months) is solo-with-Cursor buildable. Phase 2 (~3 months) and Phase 3 (~3-4 months) assume a small team, not solo — flagged again here because it changes how you should read the build order below: Phase 1 is a literal week-by-week plan, Phase 2/3 are a dependency-ordered plan, not a fixed calendar.

---

## 1. The Core Data Model: Session as an Event Log

This is the one decision every other feature in every phase depends on. Get it right before writing any other code.

**Every AI Work Session is modeled as an append-only event log, never as a mutable document.**

```
Session
 └── Events (ordered, immutable, timestamped)
      - user_message
      - suggestion              (Feature 1.1 — non-pilot proposes a message)
      - agent_message
      - agent_tool_call / tool_result
      - checkpoint_raised / checkpoint_resolved
      - role_change
      - branch_created
      - handoff_brief
      - compliance_flag         (Phase 3 — added without touching the log's shape)
```

Why this single decision carries the entire 24-feature roadmap:
- **Branching (1.4)** = fork the log at event N. No special branching infrastructure — it's the same mechanism as Git.
- **Replay / timeline (1.6/1.7)** = replay events 0..N. Free, because you modeled it this way from day one.
- **Audit trail / Compliance Vault (3.1)** = the event log *is* the audit trail. `compliance_events` in Phase 3 is a filtered view over it, not a parallel system.
- **Cost tracking (1.8)** = a `cost_usd` field on relevant events, summed. No separate metering system.
- **Org Memory Graph (3.2)** = graph edges are largely derived as a side effect of existing event types (a `checkpoint_resolved` approval becomes an `approved_by` edge) — not a manually authored second dataset.
- **New feature in Phase 2 or 3 you haven't thought of yet** = almost certainly a new `event_type` plus a small satellite table, not a new subsystem.

The discipline to hold onto through all three phases: **extend the event vocabulary, don't fork the architecture.** Every time a new phase's feature seems to need its own database/logging/state system, the right instinct is to ask whether it's actually just a new `event_type` and a satellite table referencing `session_events`.

---

## 2. Foundational Database Schema (build this before anything else)

These 5 tables are the foundation every single feature in every phase reads or writes through. This is the schema `multiplayer-ai-complete-spec.md` refers to as "specified previously" — reproduced here in full so it's never missing again.

```sql
-- Organizations
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- Users (mirrors Clerk auth records for local foreign keys)
create table users (
  id uuid primary key default gen_random_uuid(),
  clerk_id text unique not null,
  org_id uuid references orgs(id),
  name text,
  email text,
  created_at timestamptz default now()
);

-- The core object: one AI Work Session
create table sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id),
  title text,
  status text not null default 'active',       -- active | paused | completed | archived
  session_template text,                        -- null | 'incident_response' | 'architecture_decision' (Feature 1.10)
  visibility text not null default 'internal_only', -- internal_only | client_facing (Feature 2.2)
  parent_session_id uuid references sessions(id),   -- set only if this session is a branch (Feature 1.4)
  forked_from_event_seq int,
  created_by uuid references users(id),
  created_at timestamptz default now()
);

-- Who can do what in a given session (Feature 1.2; generalized in Feature 3.4)
create table session_members (
  session_id uuid references sessions(id),
  user_id uuid references users(id),
  role text not null,        -- owner | pilot | co_pilot | reviewer | observer | auditor (or custom_roles.id in Phase 3)
  is_guest boolean default false,        -- Feature 2.2
  guest_org_name text,                    -- Feature 2.2
  primary key (session_id, user_id)
);

-- THE core table -- append-only event log, source of truth for every feature in every phase
create table session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) not null,
  sequence_number int not null,
  event_type text not null,
  actor_id uuid references users(id),      -- null if actor is an agent
  actor_type text not null,                -- human | agent
  payload jsonb not null,
  token_usage jsonb,                        -- Feature 1.8
  cost_usd numeric,                         -- Feature 1.8
  created_at timestamptz default now(),
  unique (session_id, sequence_number)
);
create index on session_events (session_id, sequence_number);

-- Row-Level Security: enable from day one (see Security section below), even before you need it
alter table sessions enable row level security;
alter table session_events enable row level security;
alter table session_members enable row level security;
```

**Why `payload jsonb` instead of a rigid column-per-event-type schema:** across 24 features you will add many event types. A rigid schema means a migration every time a new phase adds a feature. JSONB + a TypeScript/Zod schema per `event_type` at the application layer gives you flexibility where you need it (payload shape) while keeping real, indexed columns for what you actually query on (`session_id`, `sequence_number`, `cost_usd`).

**Every satellite table added in later phases** (`checkpoint_policies`, `memory_facts`, `agents`, `task_graphs`, `compliance_policies`, `custom_roles`, etc. — all fully specified in `multiplayer-ai-complete-spec.md`) references these 5 tables. None of them replace or restructure this foundation.

---

## 3. Architecture by Layer (all 24 features fit into 4 layers)

Full subsystem-level detail is in `multiplayer-ai-complete-technical-guide.md` — summarized here so the build order in the companion doc makes sense at a glance.

| Layer | Features it contains | Built in |
|---|---|---|
| **Collaboration** — the event log, real-time fan-out, presence, roles, branching | 1.1, 1.2, 1.4, 1.6, 1.7, 1.10 | Phase 1 |
| **Orchestration** — durable execution, multi-agent/multi-model, tool integrations, task graphs | 1.5, 1.9, 2.3, 2.4, 2.5 | Phase 1-2 |
| **Governance** — policy engine (checkpoints, compliance, RBAC), cost tracking, audit | 1.3, 1.8, 3.1, 3.3, 3.4 | Phase 1 core, Phase 3 full |
| **Intelligence** — memory, graph, search, analytics/recommendations | 2.1, 2.7, 3.2, 3.3 (analytics half), "Ask the Company" | Phase 2-3 |

Plus 4 cross-cutting features that don't belong to one layer: Session Replay/Playbooks (1.6+2.8, spans Collaboration+Orchestration), Cross-Org Collaboration/Guest Access (2.2), Cross-Org AI Graph (3.4-equivalent — see numbering note below), and Marketplace (3.5).

**Numbering note:** `multiplayer-ai-complete-spec.md` is the canonical feature list and numbering (1.1-1.10, 2.1-2.8, 3.1-3.6). This document and the development-flow doc always defer to that numbering — if you ever see a mismatch, the spec doc wins.

### 3.1 Real-time layer (Feature 1.1)
- Redis Pub/Sub for event fan-out from writer to all connected viewers of a session
- WebSocket gateway (self-hosted `ws`, or managed via Ably) subscribing per-session
- Liveblocks for presence/cursors specifically (a separate, complementary concern from event fan-out)
- Late joiners: fetch history via `GET /sessions/:id/events?since=N`, then subscribe live — Postgres is always the source of truth, the socket is only a delivery mechanism

### 3.2 Durable execution (Features 1.3, 1.5, 2.3)
- Phase 1: Inngest or Trigger.dev — sufficient for checkpoint pause/resume and scheduled handoff-brief generation
- Phase 2: migrate the agent-run workflow to **Temporal** once Delegation Chains (2.3) introduce real multi-node dependency graphs — Temporal's workflow model maps directly onto `task_graphs`/`task_nodes`

### 3.3 Model & agent orchestration (Features 1.1, 1.9, 2.3, 2.4)
- Vercel AI SDK or LiteLLM as the provider-agnostic call layer (Claude/GPT/Gemini/self-hosted, one interface)
- Single agent + tool-calling loop is enough through Phase 1
- LangGraph (or equivalent) introduced narrowly in Phase 2, only for the Manager Agent's goal-decomposition step (2.3) — don't generalize it to the simple single-agent path

### 3.4 The policy engine (Features 1.3, 3.1, 3.4)
- One evaluator, three consumers: checkpoint rules (Phase 1), compliance framework rules (Phase 3), custom role permissions (Phase 3)
- Build as a plain function evaluated as a step in the orchestration workflow — not a dedicated rules-engine product, until policy complexity genuinely requires non-engineers to author rules

### 3.5 Intelligence layer (Features 2.1, 3.2, 3.3, "Ask the Company")
- pgvector on the same Postgres instance for memory fact embeddings — no separate vector DB
- Graph as Postgres adjacency-list tables (`graph_nodes`/`graph_edges`) — no separate graph DB
- "Ask the Company" is a RAG pattern: hybrid vector + full-text + graph traversal, synthesized by an LLM call with citations — not a dedicated search service

---

## 4. Frontend Architecture (all phases)

- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, unchanged across all 3 phases
- TanStack Query for all server data; Liveblocks hooks for presence
- **Event-renderer-registry pattern, decided in Phase 1:** the timeline component that renders `user_message`/`agent_message` in Phase 1 is the *same* component that renders checkpoint cards, memory citations, task graph updates, and compliance flags in Phase 2/3 — differentiated by an `event_type -> renderer` map, not by separate page architectures per phase. Deciding this pattern in Phase 1 (even with only ~8 event types) is what keeps Phase 2/3 frontend work from becoming a rebuild.

## 5. Backend Architecture (all phases)

- Phase 1: single Next.js app (API routes + frontend together) -- don't split services yet
- Phase 2: split durable-execution workers into their own deployable process (different scaling profile than request/response API routes) -- first real service boundary
- Phase 3: consider a third worker service for the Intelligence Layer jobs (memory extraction, graph updates, analytics) only if job volume genuinely competes with Phase 2's orchestration workers for resources. Two-to-three services is enough for a long time -- resist a general move to microservices.

## 6. Data Layer (one database carries all 3 phases)

| Store | Purpose | Introduced |
|---|---|---|
| Postgres (Supabase/Neon) | Everything relational -- the foundation in Section 2, plus every satellite table in every phase | Phase 1 |
| pgvector extension | Memory fact embeddings, semantic search | Phase 2 |
| Redis (Upstash) | Pub/sub fan-out, job queue backing | Phase 1 |
| S3-compatible (Cloudflare R2) | Uploaded documents, exports, transcripts | Phase 1 |
| Postgres RLS | Multi-tenant isolation | Phase 1 (enabled early even though not load-bearing until Phase 2's cross-org features) |

No specialized vector DB, graph DB, or analytics/OLAP store across any phase in this plan -- every "do we need X" question resolves to "Postgres handles it" until you have measured evidence otherwise.

## 7. Security & Compliance Infrastructure

- Tool connector credentials (Feature 1.9) and guest invite tokens (Feature 2.2) encrypted at rest from Phase 1 -- cheap now, expensive to retrofit
- RLS enabled from Phase 1, relied on more heavily once Phase 2's guest/cross-org features exist
- SOC2/compliance readiness (Phase 3) is mostly a byproduct of the event log + RLS + encrypted credentials you'll already have -- not a separate infrastructure buildout, mainly a business/documentation process layered on top

---

## 8. What NOT to Build Yourself (any phase)

- WebSocket scaling infra -> Ably/Liveblocks
- Durable workflow execution -> Inngest/Trigger.dev (Phase 1), Temporal (Phase 2+)
- Auth -> Clerk/Auth.js
- Vector search infra -> pgvector
- Graph database -> Postgres adjacency tables
- Multi-agent orchestration framework -> Vercel AI SDK / LiteLLM, LangGraph only for the Manager Agent step
- Compliance rules engine -> the same policy evaluator you build in Phase 1 for checkpoints, extended
- Analytics/OLAP store -> Postgres aggregate queries until measured evidence says otherwise

For the exact numbered build sequence -- what to build first within the database, backend, and frontend, across all three phases -- see `multiplayer-ai-development-flow.md`.
