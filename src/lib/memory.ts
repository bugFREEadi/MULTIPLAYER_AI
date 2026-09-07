import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { memoryFacts, sessions, users } from "@/db/schema";
import { AuthError } from "@/lib/auth-error";
import { embedText } from "@/lib/embeddings";
import { listSessionEvents } from "@/lib/events";
import { isMockAiEnabled } from "@/lib/mock-ai";

export type MemoryFactRow = typeof memoryFacts.$inferSelect;

export const MEMORY_SCOPES = [
  "company",
  "team",
  "project",
  "personal",
] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_STATUSES = ["pending", "curated", "rejected"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export function isMemoryScope(value: string): value is MemoryScope {
  return (MEMORY_SCOPES as readonly string[]).includes(value);
}

export function isMemoryStatus(value: string): value is MemoryStatus {
  return (MEMORY_STATUSES as readonly string[]).includes(value);
}

/** Narrower scopes override broader ones for ranking weight (personal highest). */
const SCOPE_WEIGHT: Record<MemoryScope, number> = {
  personal: 4,
  project: 3,
  team: 2,
  company: 1,
};

function payloadContent(payload: unknown): string {
  if (payload && typeof payload === "object" && "content" in payload) {
    const content = (payload as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return "";
}

export type ExtractedCandidate = {
  fact: string;
  scope: MemoryScope;
  scopeId: string | null;
  sourceEventSeq: number;
};

/**
 * Mock fact extraction — keyword / decision-ish pulls from event text.
 * Proves the extract→store pipeline only; does NOT simulate real LLM
 * extraction quality, relevance, or non-trivial nuance detection.
 */
export function mockExtractFactsFromEvents(opts: {
  orgId: string;
  userId: string | null;
  sessionId: string;
  events: Array<{
    sequenceNumber: number;
    eventType: string;
    payload: unknown;
  }>;
}): ExtractedCandidate[] {
  const out: ExtractedCandidate[] = [];
  const seen = new Set<string>();

  for (const event of opts.events) {
    if (
      event.eventType !== "user_message" &&
      event.eventType !== "agent_message"
    ) {
      continue;
    }
    const text = payloadContent(event.payload).trim();
    if (!text || text.startsWith("[MOCK RESPONSE]")) {
      // Still allow mock agent text for keyword pulls, but strip prefix.
    }
    const cleaned = text.replace(/^\[MOCK RESPONSE\]\s*/i, "").trim();
    if (cleaned.length < 12) continue;

    const decision =
      cleaned.match(
        /(?:we\s+)?(?:decided|agreed|will use|prefer|chose|policy is)\s+(.+)/i
      ) ??
      cleaned.match(/(?:deploy|rollback|migrate|use)\s+([^.!?\n]{8,120})/i);

    if (decision?.[1]) {
      const fact = `Decision: ${decision[1].trim().replace(/\s+/g, " ").slice(0, 240)}`;
      if (!seen.has(fact.toLowerCase())) {
        seen.add(fact.toLowerCase());
        const personal = /\b(my|i)\b/i.test(cleaned);
        out.push({
          fact,
          scope: personal ? "personal" : "company",
          scopeId: personal ? opts.userId : opts.orgId,
          sourceEventSeq: event.sequenceNumber,
        });
      }
    }

    // Capitalized multi-word phrases as weak "entity" facts.
    const entities = cleaned.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g);
    if (entities) {
      for (const entity of entities.slice(0, 2)) {
        const fact = `Mentioned: ${entity}`;
        if (seen.has(fact.toLowerCase())) continue;
        seen.add(fact.toLowerCase());
        out.push({
          fact,
          scope: "project",
          scopeId: opts.sessionId,
          sourceEventSeq: event.sequenceNumber,
        });
      }
    }

    // Fallback: short summary of the message for pipeline demos.
    if (out.filter((f) => f.sourceEventSeq === event.sequenceNumber).length === 0) {
      const fact = `Note: ${cleaned.slice(0, 180)}${cleaned.length > 180 ? "…" : ""}`;
      if (!seen.has(fact.toLowerCase())) {
        seen.add(fact.toLowerCase());
        const personal = /\b(my preference|i prefer|i always|personally)\b/i.test(
          cleaned
        );
        out.push({
          fact,
          scope: personal ? "personal" : "company",
          scopeId: personal ? opts.userId : opts.orgId,
          sourceEventSeq: event.sequenceNumber,
        });
      }
    }
  }

  return out.slice(0, 8);
}

async function realExtractFactsFromEvents(_opts: {
  orgId: string;
  userId: string | null;
  sessionId: string;
  events: Array<{
    sequenceNumber: number;
    eventType: string;
    payload: unknown;
  }>;
}): Promise<ExtractedCandidate[]> {
  throw new AuthError(
    "Real memory extraction requires MOCK_AI_RESPONSES=false and a wired model — not configured yet",
    501
  );
}

export async function extractCandidates(opts: {
  orgId: string;
  userId: string | null;
  sessionId: string;
  events: Array<{
    sequenceNumber: number;
    eventType: string;
    payload: unknown;
  }>;
}): Promise<ExtractedCandidate[]> {
  if (isMockAiEnabled()) {
    return mockExtractFactsFromEvents(opts);
  }
  return realExtractFactsFromEvents(opts);
}

/**
 * Extract new candidate facts from a session's events not yet cited.
 * Writes status=pending with embeddings.
 */
export async function runMemoryExtraction(sessionId: string): Promise<{
  inserted: MemoryFactRow[];
  skippedExisting: number;
  candidateCount: number;
}> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!session?.orgId) {
    throw new AuthError("Session not found or has no org", 404);
  }

  const events = await listSessionEvents(sessionId, 0);
  const existing = await db
    .select({
      seq: memoryFacts.sourceEventSeq,
      fact: memoryFacts.fact,
    })
    .from(memoryFacts)
    .where(eq(memoryFacts.sourceSessionId, sessionId));

  const existingSeqs = new Set(
    existing.map((e) => e.seq).filter((s): s is number => s != null)
  );
  const existingFacts = new Set(existing.map((e) => e.fact.toLowerCase()));

  const freshEvents = events.filter(
    (e) =>
      (e.eventType === "user_message" || e.eventType === "agent_message") &&
      !existingSeqs.has(e.sequenceNumber)
  );

  const candidates = await extractCandidates({
    orgId: session.orgId,
    userId: session.createdBy,
    sessionId,
    events: freshEvents.map((e) => ({
      sequenceNumber: e.sequenceNumber,
      eventType: e.eventType,
      payload: e.payload,
    })),
  });

  const novel = candidates.filter(
    (c) => !existingFacts.has(c.fact.toLowerCase())
  );

  const inserted: MemoryFactRow[] = [];
  for (const c of novel) {
    const embedding = await embedText(c.fact);
    const [row] = await db
      .insert(memoryFacts)
      .values({
        orgId: session.orgId,
        scope: c.scope,
        scopeId: c.scopeId,
        fact: c.fact,
        embedding,
        sourceSessionId: sessionId,
        sourceEventSeq: c.sourceEventSeq,
        status: "pending",
      })
      .returning();
    inserted.push(row);
  }

  return {
    inserted,
    skippedExisting: existing.length,
    candidateCount: candidates.length,
  };
}

export type RecalledFact = {
  id: string;
  fact: string;
  scope: MemoryScope;
  scopeId: string | null;
  status: MemoryStatus;
  sourceSessionId: string | null;
  sourceEventSeq: number | null;
  distance: number;
  score: number;
  sourceSessionTitle: string | null;
};

function cosineDistance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!denom) return 1;
  return 1 - dot / denom;
}

/**
 * Retrieve top-k curated facts for a session context.
 * Enforces org isolation and scope visibility:
 * - company: org-wide
 * - team: scope_id matches org (single-team stand-in until teams exist)
 * - project: scope_id matches this session
 * - personal: scope_id matches the requesting user only
 *
 * Ranking: in-process cosine over jsonb embeddings (host has no pgvector yet).
 */
export async function retrieveMemoryForSession(opts: {
  orgId: string;
  sessionId: string;
  userId: string;
  contextText: string;
  topK?: number;
}): Promise<RecalledFact[]> {
  const topK = opts.topK ?? 8;
  const queryEmbedding = await embedText(opts.contextText);

  const candidates = await db
    .select()
    .from(memoryFacts)
    .where(
      and(
        eq(memoryFacts.orgId, opts.orgId),
        eq(memoryFacts.status, "curated"),
        or(
          and(
            eq(memoryFacts.scope, "company"),
            eq(memoryFacts.scopeId, opts.orgId)
          ),
          and(eq(memoryFacts.scope, "team"), eq(memoryFacts.scopeId, opts.orgId)),
          and(
            eq(memoryFacts.scope, "project"),
            eq(memoryFacts.scopeId, opts.sessionId)
          ),
          and(
            eq(memoryFacts.scope, "personal"),
            eq(memoryFacts.scopeId, opts.userId)
          )
        )
      )
    );

  const sessionIds = [
    ...new Set(
      candidates
        .map((r) => r.sourceSessionId)
        .filter((id): id is string => !!id)
    ),
  ];
  const sessionRows =
    sessionIds.length === 0
      ? []
      : await db
          .select({ id: sessions.id, title: sessions.title })
          .from(sessions)
          .where(inArray(sessions.id, sessionIds));
  const titleById = new Map(sessionRows.map((s) => [s.id, s.title]));

  const scored = candidates
    .map((r) => {
      const emb = Array.isArray(r.embedding) ? r.embedding : [];
      const distance = emb.length
        ? cosineDistance(queryEmbedding, emb)
        : 1;
      const scope = (isMemoryScope(r.scope) ? r.scope : "company") as MemoryScope;
      const weight = SCOPE_WEIGHT[scope] ?? 1;
      const score = (1 / (1 + distance)) * (1 + weight * 0.05);
      return {
        id: r.id,
        fact: r.fact,
        scope,
        scopeId: r.scopeId,
        status: "curated" as const,
        sourceSessionId: r.sourceSessionId,
        sourceEventSeq: r.sourceEventSeq,
        distance,
        score,
        sourceSessionTitle: r.sourceSessionId
          ? titleById.get(r.sourceSessionId) ?? null
          : null,
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

export async function buildSessionContextText(
  sessionId: string
): Promise<string> {
  const events = await listSessionEvents(sessionId, 0);
  const parts: string[] = [];
  for (const e of events) {
    if (e.eventType === "user_message" || e.eventType === "agent_message") {
      const c = payloadContent(e.payload);
      if (c) parts.push(c);
    }
  }
  return parts.slice(-12).join("\n");
}

export async function listPendingMemoryFacts(
  orgId: string
): Promise<MemoryFactRow[]> {
  return db
    .select()
    .from(memoryFacts)
    .where(and(eq(memoryFacts.orgId, orgId), eq(memoryFacts.status, "pending")))
    .orderBy(desc(memoryFacts.createdAt));
}

export async function listOrgMemoryFacts(
  orgId: string,
  status?: MemoryStatus
): Promise<MemoryFactRow[]> {
  if (status) {
    return db
      .select()
      .from(memoryFacts)
      .where(and(eq(memoryFacts.orgId, orgId), eq(memoryFacts.status, status)))
      .orderBy(desc(memoryFacts.createdAt));
  }
  return db
    .select()
    .from(memoryFacts)
    .where(eq(memoryFacts.orgId, orgId))
    .orderBy(desc(memoryFacts.createdAt));
}

export async function curateMemoryFact(opts: {
  orgId: string;
  factId: string;
  status: "curated" | "rejected";
}): Promise<MemoryFactRow> {
  const [existing] = await db
    .select()
    .from(memoryFacts)
    .where(
      and(eq(memoryFacts.id, opts.factId), eq(memoryFacts.orgId, opts.orgId))
    )
    .limit(1);
  if (!existing) {
    throw new AuthError("Memory fact not found", 404);
  }
  const [row] = await db
    .update(memoryFacts)
    .set({ status: opts.status })
    .where(eq(memoryFacts.id, opts.factId))
    .returning();
  return row;
}

/**
 * Periodic extraction: sessions with recent message activity and few pending scans.
 */
export async function runScheduledMemoryExtraction(): Promise<{
  sessionsProcessed: number;
  factsInserted: number;
}> {
  const recent = await db
    .select()
    .from(sessions)
    .where(eq(sessions.status, "active"))
    .orderBy(desc(sessions.createdAt))
    .limit(25);

  let sessionsProcessed = 0;
  let factsInserted = 0;
  for (const session of recent) {
    try {
      const result = await runMemoryExtraction(session.id);
      sessionsProcessed += 1;
      factsInserted += result.inserted.length;
    } catch {
      /* skip sessions that fail extraction */
    }
  }
  return { sessionsProcessed, factsInserted };
}

export async function serializeFact(row: MemoryFactRow) {
  return {
    id: row.id,
    orgId: row.orgId,
    scope: row.scope,
    scopeId: row.scopeId,
    fact: row.fact,
    sourceSessionId: row.sourceSessionId,
    sourceEventSeq: row.sourceEventSeq,
    status: row.status,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt
          ? String(row.createdAt)
          : null,
  };
}

/** Resolve owner display for curation queue — optional. */
export async function getUserBrief(userId: string | null) {
  if (!userId) return null;
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email };
}
