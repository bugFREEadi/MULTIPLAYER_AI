/**
 * Step 18 verification harness — run with:
 *   npx tsx scripts/verify-step18.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { eq, and } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const {
    memoryFacts,
    sessionMembers,
    sessions,
    users,
  } = await import("../src/db/schema");
  const { appendSessionEvent } = await import("../src/lib/events");
  const {
    curateMemoryFact,
    retrieveMemoryForSession,
    runMemoryExtraction,
  } = await import("../src/lib/memory");
  const { embedText } = await import("../src/lib/embeddings");

  const allUsers = await db.select().from(users).limit(5);
  const userA = allUsers[0];
  if (!userA?.orgId) {
    throw new Error("Need at least one user with orgId");
  }
  const orgId = userA.orgId;

  // Second user for scope isolation (create if missing)
  let userB = allUsers.find((u) => u.id !== userA.id && u.orgId === orgId);
  if (!userB) {
    const [created] = await db
      .insert(users)
      .values({
        clerkId: `verify-step18-user-b-${Date.now()}`,
        orgId,
        name: "Verify User B",
        email: "verify-b@example.com",
      })
      .returning();
    userB = created;
  }

  async function makeSession(title: string, createdBy: string) {
    const [session] = await db
      .insert(sessions)
      .values({
        orgId,
        title,
        createdBy,
        status: "active",
        visibility: "internal_only",
      })
      .returning();
    await db.insert(sessionMembers).values({
      sessionId: session.id,
      userId: createdBy,
      role: "owner",
    });
    return session;
  }

  const s1 = await makeSession("step18-source", userA.id);
  await appendSessionEvent({
    sessionId: s1.id,
    eventType: "user_message",
    actorId: userA.id,
    actorType: "human",
    payload: {
      content:
        "We decided to use Postgres with pgvector for Team AI Memory storage.",
    },
  });
  await appendSessionEvent({
    sessionId: s1.id,
    eventType: "agent_message",
    actorId: null,
    actorType: "agent",
    payload: {
      content:
        "[MOCK RESPONSE] Agreed — Postgres pgvector keeps memory on one database.",
    },
  });
  await appendSessionEvent({
    sessionId: s1.id,
    eventType: "user_message",
    actorId: userA.id,
    actorType: "human",
    payload: {
      content: "My preference is dark-mode dashboards for ops reviews.",
    },
  });

  const extraction = await runMemoryExtraction(s1.id);
  console.log(
    "extraction inserted",
    extraction.inserted.length,
    extraction.inserted.map((f) => ({
      fact: f.fact,
      scope: f.scope,
      seq: f.sourceEventSeq,
      status: f.status,
    }))
  );
  if (extraction.inserted.length < 1) {
    throw new Error("Expected pending facts from extraction");
  }
  if (!extraction.inserted.every((f) => f.status === "pending")) {
    throw new Error("Extracted facts must be pending");
  }
  if (
    !extraction.inserted.every(
      (f) => f.sourceSessionId === s1.id && f.sourceEventSeq != null
    )
  ) {
    throw new Error("Facts must cite source session + event seq");
  }

  // Curate a company-scoped fact if present, else first fact as company
  let companyFact =
    extraction.inserted.find((f) => f.scope === "company") ??
    extraction.inserted[0];
  if (companyFact.scope !== "company") {
    const [updated] = await db
      .update(memoryFacts)
      .set({ scope: "company", scopeId: orgId })
      .where(eq(memoryFacts.id, companyFact.id))
      .returning();
    companyFact = updated;
  }
  await curateMemoryFact({
    orgId,
    factId: companyFact.id,
    status: "curated",
  });

  // Personal fact for user A
  const [personal] = await db
    .insert(memoryFacts)
    .values({
      orgId,
      scope: "personal",
      scopeId: userA.id,
      fact: "Personal: User A prefers dark-mode dashboards for ops reviews.",
      embedding: await embedText(
        "Personal: User A prefers dark-mode dashboards for ops reviews."
      ),
      sourceSessionId: s1.id,
      sourceEventSeq: 3,
      status: "curated",
    })
    .returning();

  const s2 = await makeSession("step18-recall", userA.id);
  await appendSessionEvent({
    sessionId: s2.id,
    eventType: "user_message",
    actorId: userA.id,
    actorType: "human",
    payload: {
      content: "Remind me about our Postgres pgvector memory decision.",
    },
  });

  const recalledA = await retrieveMemoryForSession({
    orgId,
    sessionId: s2.id,
    userId: userA.id,
    contextText: "Remind me about our Postgres pgvector memory decision.",
  });
  console.log(
    "recalled for A",
    recalledA.map((f) => ({ id: f.id, fact: f.fact.slice(0, 60), scope: f.scope }))
  );
  if (!recalledA.some((f) => f.id === companyFact.id)) {
    throw new Error("Curated company fact should surface for user A");
  }
  if (!recalledA.some((f) => f.id === personal.id)) {
    console.warn(
      "Personal fact may not rank in top-k for this context — checking isolation separately"
    );
  }

  const recalledB = await retrieveMemoryForSession({
    orgId,
    sessionId: s2.id,
    userId: userB.id,
    contextText: "Remind me about our Postgres pgvector memory decision.",
  });
  console.log(
    "recalled for B",
    recalledB.map((f) => ({ id: f.id, scope: f.scope }))
  );
  if (recalledB.some((f) => f.id === personal.id)) {
    throw new Error("Personal fact for A must NOT surface for user B");
  }
  if (!recalledB.some((f) => f.id === companyFact.id)) {
    throw new Error("Company fact should still surface for user B");
  }

  // Explicit personal-context retrieval for A
  const personalRecall = await retrieveMemoryForSession({
    orgId,
    sessionId: s2.id,
    userId: userA.id,
    contextText: "dark-mode dashboards for ops reviews preference",
    topK: 10,
  });
  if (!personalRecall.some((f) => f.id === personal.id)) {
    throw new Error("User A should retrieve own personal fact with matching context");
  }

  // Org isolation: fact in another org must never appear
  const [otherOrg] = await db
    .insert((await import("../src/db/schema")).orgs)
    .values({ name: "Other Org Step18" })
    .returning();
  const [leaky] = await db
    .insert(memoryFacts)
    .values({
      orgId: otherOrg.id,
      scope: "company",
      scopeId: otherOrg.id,
      fact: "SECRET: other org should never leak Postgres facts.",
      embedding: await embedText(
        "SECRET: other org should never leak Postgres facts."
      ),
      status: "curated",
    })
    .returning();
  const cross = await retrieveMemoryForSession({
    orgId,
    sessionId: s2.id,
    userId: userA.id,
    contextText: "SECRET other org Postgres facts",
    topK: 20,
  });
  if (cross.some((f) => f.id === leaky.id)) {
    throw new Error("Cross-org memory leak detected");
  }

  console.log("\nSTEP 18 VERIFY OK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
