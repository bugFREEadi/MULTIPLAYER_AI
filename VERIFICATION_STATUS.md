# Phase 1 verification status

Statuses:
- **FULLY VERIFIED** — correctness does not depend on real AI output quality
- **MOCK-VERIFIED ONLY — needs re-verification with real API key** — depends on real model behavior/output
- **NOT STARTED** — not built yet

`MOCK_AI_RESPONSES` defaults to on (`!== "false"`). Flip to `false` after adding a real `ANTHROPIC_API_KEY` to re-test AI-dependent steps.

| Step | Feature | Status |
|---|---|---|
| 4 | Single-agent AI loop | MOCK-VERIFIED ONLY — needs re-verification with real API key |
| 5 | Frontend: auth + session list | FULLY VERIFIED |
| 6 | Frontend: static session view | FULLY VERIFIED |
| 7 | Frontend: streaming responses | MOCK-VERIFIED ONLY — needs re-verification with real API key |
| 8 | Real-time fan-out | FULLY VERIFIED |
| 9 | Role enforcement | FULLY VERIFIED |
| 10 | Checkpoint system | FULLY VERIFIED |
| 11 | Branching | FULLY VERIFIED |
| 12 | Async handoff | MOCK-VERIFIED ONLY — needs re-verification with real API key |
| 13 | Cost meter | MOCK-VERIFIED ONLY — needs re-verification with real API key |
| 14 | Tool Mesh | FULLY VERIFIED |
| 15 | Session templates | FULLY VERIFIED |
| 16 | Timeline / replay | FULLY VERIFIED |

## Notes

### Step 4
Part A mock path verified (2026-09-06):
- Single-turn: `user_message` then `agent_message` with `[MOCK RESPONSE]` prefix, fake `token_usage` + `cost_usd`
- Mock tool shape: `[mock_tool:github]` → `agent_tool_call` with `tool_call_id` / `tool_name` / `arguments`
- Concurrency: 3 parallel turns → contiguous sequence numbers, no gaps/duplicates

Real Claude content, provider `token_usage`, and real `cost_usd` remain unverified until `MOCK_AI_RESPONSES=false` and a valid `ANTHROPIC_API_KEY` are set.

### Step 5
**FULLY VERIFIED** (2026-09-06) — browser walkthrough confirmed by user:
1. Sign in at `/sign-in`
2. Land on `/sessions`
3. Session list correct
4. New Session creates + navigates to `/sessions/[id]`
5. Back + refresh — session still listed

Also includes Clerk Core 3 migration (`Show`, `ClerkProvider` inside `<body>`, resource-level `auth.protect()` on `/sessions`). No AI-output dependency.

### Step 6
**FULLY VERIFIED** (2026-09-06) — browser confirmed: user + mock agent bubbles in order after send/refetch. Mock agent text is expected; no real-API re-verify needed for this UI step.

### Step 7
**MOCK-VERIFIED ONLY — needs re-verification with real API key** (2026-09-06).
- Browser confirmed: longer message, agent bubble grows piece-by-piece, no flash/blank on swap; `[mock-stream client raw]` logs show spaced timestamps
- `useCompletion` + `POST /api/sessions/:id/stream` text protocol; mock chunked delays (~35ms); one `agent_message` via `appendSessionEvent` after stream ends
- Real Anthropic token-level chunk timing/size still unchecked until `MOCK_AI_RESPONSES=false` + valid key

### Step 8
**FULLY VERIFIED** (2026-09-06) — Redis pub/sub + live channel + suggestions.
- Every `appendSessionEvent` publishes `{ session_id, event }` to Redis `session:{id}`
- Live gateway: **SSE** `GET /api/sessions/:id/live` (not WebSocket/Ably)
- Two-tab Playwright harness: send from tab A → `user_message` + `agent_message` appear live in tab B (no refresh)
- `suggestion` / accept (→ `user_message` + agent stream) / dismiss; `POST .../members` for reviewer invite
- Mock agent text in the live agent event is expected; fan-out itself is not AI-key-dependent

**Spec deviations / deferred from Feature 1.1 (do not drop silently):**
- **SSE instead of WebSocket gateway / Ably** — pragmatic for Next.js App Router unidirectional event fan-out. Revisit if a later phase needs bidirectional real-time (client→server over the same socket, richer presence sync, etc.).
- **Liveblocks presence/cursors (avatars / who's-viewing) — NOT BUILT — deferred from Step 8, presence/cursors still needed.** Not blocking downstream steps; must be scheduled explicitly, not forgotten.

### Step 9
**FULLY VERIFIED** (2026-09-06) — single RBAC choke-point + take-control.
- `requireSessionPermission` / `assertSessionPermission` in `src/lib/rbac.ts` — all mutating session routes pass through this (not scattered allow-lists)
- Actions: `user_message.write`, `suggestion.write`, `suggestion.resolve`, `members.manage`, `session.take_control`
- `POST /api/sessions/:id/take-control` → membership updates + `role_change` event via Step 8 fan-out
- UI: participant role badges, permission-gated input (observers view-only), Take control control
- Verified: reviewer/observer cannot `user_message`; reviewer can suggest; take-control broadcasts `role_change` live; new pilot can write

### Step 10
**FULLY VERIFIED** (2026-09-06) — checkpoint policies + pause/resume.
- Table `checkpoint_policies` (migration `0001`); triggers `keyword` | `manual` evaluated now; `tool_call` / `budget_threshold` reserved for Steps 14 / 13
- Single evaluator `evaluatePolicies` in `src/lib/checkpoints.ts` — extend trigger union later, do not replace
- `checkpoint_raised` / `checkpoint_resolved` via `appendSessionEvent` → Redis/SSE fan-out; session `status=paused_checkpoint` blocks new turns
- `POST /api/sessions/:id/checkpoints/:eventId/resolve` — only `required_role` may approve/reject; approve resumes and runs the deferred agent turn
- UI: rose checkpoint card with Approve/Reject; pause banner; org policy CRUD at `/settings/policies`
- Verified: keyword `"deploy"` → raise + pause; reviewer 403 on resolve; owner approve → resume + agent; further messages unblocked; stream path also pauses with 409

### Step 11
**FULLY VERIFIED** (2026-09-06) — branching without event copy.
- Table `branch_merges` (migration `0002`)
- `POST /api/sessions/:id/branch` — sets `parent_session_id` + `forked_from_event_seq`; branch starts `active` (independent of parent pause)
- `listSessionEvents` walks parent ancestry for seq ≤ fork, then own events; branch seq continues after fork floor; live channel still `session:{branchId}` only
- `POST /api/sessions/:id/merge` — human `mergeSummary` + `rejectedBranches`; no content auto-merge
- UI: “Branch from here”, `/sessions/compare?left=&right=`, merge record form
- Verified: fork @2 inherits only seq≤2; branch-only messages stay off parent; parent post-fork / pause does not affect branch; merge stores summary + rejected id

### Step 12
**MOCK-VERIFIED ONLY — needs re-verification with real API key** (2026-09-06).
- `handoff_brief` via `generateHandoffBrief` → `appendSessionEvent` (Step 8 fan-out); mock path when `MOCK_AI_RESPONSES!=="false"` with `[MOCK HANDOFF BRIEF]` prefix
- On-demand `POST /api/sessions/:id/handoff` (RBAC `session.handoff`, allowed while paused); schedule wired via Inngest cron every 3h → `runScheduledHandoffs` (`/api/inngest`) — light wire only, not deeply tested against long sessions
- `GET /api/sessions/:id/pending-decisions` — unresolved own-session `checkpoint_raised` (no matching `checkpoint_resolved`)
- UI: sky handoff brief card, Generate handoff button, Pending decisions panel
- Verified (mock): messages → on-demand brief in timeline with mock summary; open checkpoint appears in pending panel; resolve clears it
- Real LLM brief quality/token usage unchecked until `MOCK_AI_RESPONSES=false` + valid `ANTHROPIC_API_KEY`

### Step 13
**MOCK-VERIFIED ONLY — needs re-verification with real API key** (2026-09-06).
- Table `budget_limits` (migration `0003`): `org_id` PK, `monthly_limit_usd`, `alert_threshold_pct` (default 80), plus job-maintained `soft_locked` / `alert_active`
- Shared Sonnet 5 pricing (`$2` / `$10` per MTok) in `src/lib/pricing.ts` — mock fake tokens and real usage both use the same cost formula; agent_message / agent_tool_call (and handoff) persist `token_usage` + `cost_usd`
- `GET /api/sessions/:id/cost` — `sum(cost_usd)`; UI cost meter sums event `costUsd` from history + Step 8 live fan-out
- Org dashboard `/settings/budget` + `GET|PUT|POST /api/org/budget`; Inngest hourly `scheduled-budget-checks`
- Soft-lock (402) blocks **new** sessions/messages/branches when monthly spend ≥ limit; existing session status unchanged (not killed)
- Verified (mock): meter matches event sum; alert at threshold; soft-lock blocks new session/message; existing session stays `active`
- Real Anthropic `token_usage` numbers still need re-check against this aggregation once `MOCK_AI_RESPONSES=false` + valid key

### Step 14
**FULLY VERIFIED** (2026-09-06 / OAuth confirm 2026-09-07).
- Tables `connected_tools`, `agent_tool_permissions` (migration `0004`); `agent_id` nullable until Step 17; Phase 1 scopes by `org_id` + `tool_id`
- `auth_config` stored as AES-256-GCM envelope via `TOOL_AUTH_ENCRYPTION_KEY`
- GitHub OAuth: connect redirect + callback; Tool Mesh UI at `/settings/tools`
- Permission gate in mock tool path verified earlier (restricted / requires_checkpoint / allowed)
- **OAuth connect confirmed:** org tool `github` status `active`, encrypted envelope intact, account `@bugFREEadi` returned by `GET /api/org/tools`

### Step 15
**FULLY VERIFIED** (2026-09-07).
- Template registry in `src/lib/session-templates.ts` (config object): `incident_response`, `architecture_decision`
- `sessions.session_template` set on create; seeds `template_state` event; updates via `template_update` + `POST /api/sessions/:id/template-updates`
- Views: `IncidentSessionView` / `ArchitectureSessionView` / generic `SessionViewClient` via `SessionRouter` — shared timeline + structured panels
- New Session picker on `/sessions` (generic / incident / architecture)
- Verified: incident + architecture sessions get `template_state` and panels API; generic session has no template event and still runs agent turns

### Step 16
**FULLY VERIFIED** (2026-09-07).
- Frontend-only timeline scrubber + jump-to-moment replay (`TimelineScrubber`, `src/lib/timeline-replay.ts`)
- Reconstructs display for events with `sequence_number ≤ N` using the same visibility/rendering rules as live (messages, checkpoints, handoff briefs, template events)
- Branch sessions use existing Step 11 `listSessionEvents` ancestry — scrubber shows inherited parent history ≤ fork + branch own events
- Replay banner (“Viewing session as of event #N — Return to live”); live fan-out continues into full `events` while scrubbing; return-to-live shows current state
- Verified: mixed timeline scrub helpers (checkpoint visible before resolve, hidden after); branch fork @2 inherits only ≤2 then adds own events; parent unaffected

---

## Phase 1 complete

MVP covered: multiplayer roles, checkpoints, branching, handoff, cost meter, tool mesh (GitHub), session templates, timeline replay.

**Still deferred (not Phase 1 blockers, do not forget):**
- Liveblocks presence/cursors (deferred from Step 8)
- SSE vs WebSocket/Ably revisit if bidirectional real-time is needed later

---

# Phase 2 verification status

Statuses (same as Phase 1):
- **FULLY VERIFIED** — correctness does not depend on real AI output quality
- **MOCK-VERIFIED ONLY** — needs re-verification with real API key; note must say what mock cannot judge (quality/relevance/sensibility), not merely “needs a key”
- **NOT STARTED** — not built yet

| Step | Feature | Status |
|---|---|---|
| 17 | Agent Fleet Control Plane (2.4) | FULLY VERIFIED |
| 18 | Team AI Memory (2.1) | MOCK-VERIFIED ONLY |
| 19 | Delegation Chains / Manager Agent (2.3) | MOCK-VERIFIED ONLY |
| 20 | Cross-Org Collaboration + Guest Access (2.2) | FULLY VERIFIED |
| 21 | Context Spine (2.5) | FULLY VERIFIED |
| 22 | Pattern Library (2.6) | FULLY VERIFIED |
| 23 | Playbook extraction (2.8) | MOCK-VERIFIED ONLY |
| 24 | Session Intelligence & Analytics (2.7) | FULLY VERIFIED |

**Phase 2 complete** (2026-09-07). Do not start Phase 3 until explicit “go”.

## Notes

### Step 17
**FULLY VERIFIED** (2026-09-07) — registry / runs / metrics / per-agent tool scope are infrastructure, not AI-quality dependent.

Built:
- Tables `agents`, `agent_runs`; `sessions.agent_id`; partial uniques on `agent_tool_permissions` (org-default vs per-agent) — migration `0005`
- CRUD: `GET|POST /api/org/agents`, `GET|PATCH|DELETE /api/org/agents/:id`
- Metrics rollup: run count, fail-rate, avg duration, avg cost (from Step 13 `cost_usd` in run window), last-used
- `agent_runs` start/complete hooked into `runAgentTurn` + stream path; outcomes `success` | `failure` | `escalated` (checkpoint pause)
- Per-agent Tool Mesh: `authorizeToolInvocation` prefers agent override then org default; `PATCH /api/org/tools/:id` accepts `agent_id`
- Session bind: `agent_id` on create + `PUT /api/sessions/:id/agent`
- UI: `/settings/agents` Fleet dashboard; New Session agent picker

Verified (mock harness `scripts/verify-step17.ts`):
1. Created 3 agents with different model configs
2. Sessions bound to Alpha/Beta → `agent_runs` with `success` + completed timestamps/durations
3. Metrics rollup (runs, avg cost > 0, fail-rate) correct per agent
4. GitHub permission: Alpha `allowed` vs Beta `restricted` → allow vs block; Alpha `requires_checkpoint` → paused turn + `escalated` run

**Exceptions (not MOCK-VERIFIED — still infra gaps, not “mock can’t judge quality”):**
- Live calls for non-`anthropic` `model_provider` values are rejected until wired; mock mode does not need them
- Bound `system_prompt` / `model_id` are applied on the real Anthropic path but output quality is out of scope for this step

**Cleanup (2026-09-07):** Fleet Alpha/Beta/Gamma test agents deleted; org-default GitHub permission confirmed **`allowed`** (Step 14 `ensureOrgTool` seeds `restricted` on first stub, but the working Mesh state used for real gating demos is `allowed` — verify had briefly set `restricted`; restored/confirmed `allowed` with no leftover agent-scoped overrides).

### Step 18
**MOCK-VERIFIED ONLY** (2026-09-07) — pipeline mechanically works; mock cannot judge real extraction quality.

**Why mock is insufficient:** mock extraction only does keyword/decision-ish / entity pulls from event text. It cannot judge whether a real model correctly identifies **meaningful, non-trivial facts** from conversation nuance (what to keep vs noise, correct scope, de-duplication of paraphrases, citation to the right event). That requires real model output. Mock embeddings similarly only prove lexical overlap ranking, not semantic embedding quality.

Built:
- Table `memory_facts` (migration `0006`): scope, scope_id, fact, embedding, source_session_id, source_event_seq, status
- Extraction: `runMemoryExtraction` + `POST /api/sessions/:id/memory`; Inngest hourly `scheduled-memory-extraction`
- Retrieval: `retrieveMemoryForSession` — curated only, org-isolated, scope visibility (personal / project / team / company)
- Curation: `GET /api/org/memory`, `PATCH /api/org/memory/:id` (`curated` | `rejected`)
- UI: session **Team memory** panel with source citations; `/settings/memory` curation queue; Extract memory control

Verified (`scripts/verify-step18.ts`):
1. Session messages → extract → pending facts with source session + event seq
2. Approve company fact → retrievable
3. New session with related context → curated fact surfaced in recall
4. Personal fact for user A does **not** surface for user B; company fact does; no cross-org leak

**Infra note (not the MOCK reason):** host Postgres has no `pgvector` extension (`CREATE EXTENSION vector` unavailable). Embeddings stored as `jsonb` float[1536]; ranking is in-process cosine. When pgvector is available, migrate column to `vector(1536)` + HNSW — API unchanged.

**Scaling risk (flagged — not a correctness bug):** in-process cosine over `jsonb` embeddings does a full candidate scan per retrieval (scoped by org/status/visibility filters, then ranked in app memory). Correct today; will get slow as `memory_facts` grows into the thousands+. **Revisit before real usage scales** — either enable pgvector on the Postgres host, or move to a dedicated vector store, when `memory_facts` volume is large enough that retrieval latency is noticeably slow. Do not forget this when Phase 3 “Ask the Company” / graph retrieval lands on the same store.

**DEFERRED: Temporal migration for Manager Agent / task graphs — Inngest (or sync API + DB state) drives Step 19; Temporal when dependency workflows need long-lived signals, child workflows, or stronger execution guarantees.**

### Step 19
**MOCK-VERIFIED ONLY** (2026-09-07) — task-graph plumbing verified; mock cannot judge plan quality.

**Why mock is insufficient:** mock decomposition only proves the task-graph mechanics work (create graph → spawn child sessions → `depends_on` gating → synthesis). It cannot show whether real goal decomposition produces a **sensible, well-scoped plan**, which needs real model reasoning to judge.

Built:
- Tables `task_graphs`, `task_nodes` (migration `0008`); `title` on nodes for UX; Postgres = source of truth
- Manager Agent (`src/lib/manager-agent.ts`): Chief-of-Staff via Step 18 `retrieveMemoryForSession` → mock 3-node plan → child sessions → start ready / block dependents → complete → advance → synthesis into parent
- Inngest `manager/node.completed` advances graph idempotently (sync path also advances so verify works without Inngest CLI)
- APIs: `GET|POST /api/sessions/:id/delegate`, `POST /api/task-nodes/:id/complete`
- UI: Delegation panel on session view; timeline cards for `manager_brief` / `delegation_synthesis`

Verified (`scripts/verify-step19.ts`):
1. Goal → graph + fixed 3-node mock decomposition
2. Each node has its own `child_session_id`
3. Dependent nodes stay `blocked` until deps complete; completing a blocked node fails
4. All nodes complete → `delegation_synthesis` on parent + graph `completed`
5. Chief-of-Staff recall returns ≥1 curated Step 18 memory fact during planning

**DEFERRED (engine):** Temporal — see note under Step 18 / above. Do not start Step 20 until explicit “go”.

### Step 20
**FULLY VERIFIED** (2026-09-07) — no AI-output dependency.

Built:
- Table `guest_invites` (migration `0009`); uses existing `session_members.is_guest` / `guest_org_name` and `sessions.visibility`
- Invite: `POST /api/sessions/:id/guest-invites` (role observer|reviewer) — flips session to `client_facing`
- Magic-link redeem: `POST /api/guest/redeem/:token` sets httpOnly `mp_guest_session` cookie (HMAC). Guest users are `clerkId=guest:<inviteId>`, `orgId=null` — **not** Clerk accounts
- `requireActor` + session access: cookie scoped to **one** session; `internal_only` always denied to guests; list API returns only the invited session for guests
- UI: Invite guest panel; amber **client-facing** banner for team; `/guest/invite/[token]` + `/guest/s/[id]` guest shell

Verified (`scripts/verify-step20.ts`):
1. Invite + redeem; observer cannot `user_message.write`
2. Guest blocked from other session (cookie scope + no membership)
3. Expired token rejected
4. `internal_only` blocked for guest even on invited session id
5. Session row visibility `client_facing` for team UI distinction

No MOCK exception for this step.

### Step 21
**FULLY VERIFIED** (2026-09-07) — GitHub tool API fetch/injection; no model call; not AI-quality dependent.

Built:
- `src/lib/context-spine.ts` — keyword extract from subject → GitHub Issues Search (`in:title`) via Step 14 `getGithubAccessToken` → always appends `related_context` event at templated session create
- Hooked in `POST /api/sessions` after `seedTemplateStateEvent` only when `session_template` is set (`incident_response` / `architecture_decision`); optional `subject` body field (falls back to title / template default)
- Generic sessions never call the fetch
- UI: **Related context** panel (`related-context-panel.tsx`) on templated session views with links to GitHub issues/PRs; empty / not_connected / error states without throwing
- `related_context` hidden from main timeline scrubber (panel owns display)
- No polling/webhooks — fetch-at-creation only

Verified (`scripts/verify-step21.ts`):
1. Templated + matching subject (stubbed GitHub) → `related_context` with item title + `github.com` URL
2. Templated + no-match subject → event with `status=empty`, zero items (UI: “No related context found”)
3. Generic session → no `related_context` / no `template_state`
4. Unstubbed path returns a graceful status (`not_connected` when GitHub isn’t active for the org — this workspace had no live token at verify time)

No MOCK exception — correctness is the fetch/injection mechanism, not relevance quality of keyword matching.

### Step 22
**FULLY VERIFIED** (2026-09-07; policy scoping corrected same day) — pattern config + mechanical session wiring; no AI-output dependency.

Built:
- Table `workflow_patterns` (migration `0010`): `org_id`, `name`, `steps` jsonb (`agent_id` / `role` / `checkpoint_policy_id` / `label`), `created_from_session_id` (nullable for Step 23), `is_public`
- Session wiring columns: `sessions.workflow_pattern_id`, `sessions.attached_checkpoint_policy_ids` — attached IDs are **scaffold metadata** (which policies the pattern emphasizes); Step 10 `evaluatePolicies` always uses the **full set of active org policies** (additive baseline — patterns cannot opt out of org-wide governance)
- APIs: `GET|POST /api/org/patterns`, `GET|PATCH|DELETE /api/org/patterns/:id`, `POST /api/org/patterns/:id/spin-up`
- Spin-up: creates session with first step’s `agent_id`, records attached checkpoint policy IDs, emits `pattern_scaffold` event
- UI: `/settings/patterns` library + create form; Sessions “New session” → **From pattern**; session **Pattern scaffold** panel

Verified (`scripts/verify-step22.ts`):
1. Manual pattern with 3 steps (agent X no checkpoint → agent Y + keyword policy → reviewer role)
2. Spin-up → session `agent_id` = X, `attached_checkpoint_policy_ids` = [Y’s policy]
3. **Additive governance:** pattern-attached keyword raises checkpoint; separate org-wide keyword also raises on a pattern-created session; `evaluatePolicies` returns both when the message matches both keywords
4. Org pattern list includes the created pattern

**Design note (governance):** an earlier exclusive “attached-only” filter was rejected — that would let a pattern bypass standing org policies. Correct behavior is baseline org policies ∪ pattern scaffold (scaffold does not remove baseline).

No MOCK exception for this step. Playbook auto-extraction is Step 23.

### Step 23
**MOCK-VERIFIED ONLY** (2026-09-07) — extraction pipeline works; mock cannot judge playbook quality.

**Why mock is insufficient:** mock/mechanical extraction only records which agents were bound/used and which checkpoints actually fired, in occurrence order. It cannot judge whether a real model produces a **genuinely useful, generalized pattern** (reusable steps, right abstraction level) vs an overly literal copy of one specific run. That needs real model judgment.

Built:
- `src/lib/playbooks.ts` — `markSessionCompleted`, `mechanicalExtractSteps`, `extractPlaybookFromSession` (mock → mechanical; real → LLM JSON steps with mechanical fallback)
- APIs: `POST /api/sessions/:id/complete`, `POST /api/sessions/:id/extract-playbook` (“Make this repeatable”)
- Writes `workflow_patterns` with `created_from_session_id` set; emits `playbook_extracted` event
- UI: **Mark completed** / **Make this repeatable** on session view; extracted playbooks show in Step 22 Pattern library

Verified (`scripts/verify-step23.ts`):
1. Session with bound agent + triggered checkpoint → complete → extract
2. Library pattern steps include that agent + checkpoint policy; `created_from_session_id` set
3. Spin-up from extracted pattern reuses Step 22 wiring (correct agent + attached policies)

### Step 24
**FULLY VERIFIED** (2026-09-07) — pure aggregation over existing structured data; no AI-output dependency.

Built:
- `src/lib/analytics.ts` — org aggregations over `sessions`, `session_events`, checkpoint resolutions, take-control `role_change`s; re-surfaces Step 17 `listAgentsWithMetrics` for per-agent cost
- `GET /api/org/analytics?days=7|30|90`
- UI: `/settings/analytics` — session volume chart, checkpoint approval rate (overall + per policy), take-control count, cost totals + per-session / per-agent tables; Refresh reloads from API

Verified (`scripts/verify-step24.ts` with `shim-server-only`):
1. Seeded multi-session activity (messages/costs, approve/reject checkpoints, take-control, two agents)
2. Dashboard numbers match manual SQL-equivalent counts for the same window
3. After adding another session + cost, re-fetch reflects the new totals

No MOCK exception for this step.

---

## Phase 2 — MOCK-VERIFIED ONLY (nuanced reasons)

| Step | Feature | Why mock cannot fully verify |
|---|---|---|
| 18 | Team AI Memory (2.1) | Mock extraction is keyword/heuristic pulls — cannot judge whether a real model identifies **meaningful, non-trivial facts** (keep vs noise, scope, de-dupe, correct citations). Mock embeddings only prove lexical overlap ranking, not semantic quality. |
| 19 | Delegation / Manager Agent (2.3) | Mock decomposition only proves task-graph plumbing (nodes, deps, child sessions, synthesis). Cannot show whether real goal decomposition produces a **sensible, well-scoped plan**. |
| 23 | Playbook extraction (2.8) | Mechanical extract records agents used + checkpoints fired in order — proves the pipeline. Cannot judge whether a real model yields a **useful generalized playbook** vs an overly literal copy of one run. |

(Phase 1 MOCK-VERIFIED steps 4, 7, 12, 13 remain as documented above; not restated here.)

**Phase 2 complete.** Do not start Phase 3 (Step 25+) until explicit “go”.
