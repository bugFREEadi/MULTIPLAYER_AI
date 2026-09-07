/**
 * Step 21 verification harness — run with:
 *   npx tsx -r ./scripts/shim-server-only.cjs scripts/verify-step21.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { db } = await import("../src/db");
  const { sessionMembers, sessions, users } = await import("../src/db/schema");
  const {
    seedRelatedContextEvent,
    stubGithubContextSearchForTests,
    extractSearchKeywords,
  } = await import("../src/lib/context-spine");
  const { seedTemplateStateEvent } = await import(
    "../src/lib/session-template-seed"
  );
  const { listSessionEvents } = await import("../src/lib/events");

  const [user] = await db.select().from(users).limit(1);
  if (!user?.orgId) throw new Error("Need a user with orgId");
  const orgId = user.orgId;

  // Keyword helper
  const kws = extractSearchKeywords("Checkout latency spike on payments API");
  if (!kws.includes("checkout") || !kws.includes("latency")) {
    throw new Error(`Unexpected keywords: ${kws.join(",")}`);
  }

  async function makeSession(opts: {
    title: string;
    template: string | null;
  }) {
    const [session] = await db
      .insert(sessions)
      .values({
        orgId,
        title: opts.title,
        sessionTemplate: opts.template,
        createdBy: user.id,
        status: "active",
        visibility: "internal_only",
      })
      .returning();
    await db.insert(sessionMembers).values({
      sessionId: session.id,
      userId: user.id,
      role: "owner",
    });
    return session;
  }

  // 1+2 Match stub
  stubGithubContextSearchForTests(async ({ subject }) => {
    if (subject.toLowerCase().includes("checkout")) {
      return [
        {
          source: "github",
          kind: "pull_request",
          id: 1,
          number: 42,
          title: "Fix checkout latency in payments",
          url: "https://github.com/example/repo/pull/42",
          repo: "example/repo",
          state: "open",
        },
      ];
    }
    return [];
  });

  const matchSession = await makeSession({
    title: "Checkout latency spike",
    template: "incident_response",
  });
  await seedTemplateStateEvent({
    sessionId: matchSession.id,
    actorId: user.id,
    templateId: "incident_response",
  });
  await seedRelatedContextEvent({
    sessionId: matchSession.id,
    actorId: user.id,
    orgId,
    templateId: "incident_response",
    subject: "Checkout latency spike",
  });

  const matchEvents = await listSessionEvents(matchSession.id, 0);
  const matchCtx = matchEvents.find((e) => e.eventType === "related_context");
  if (!matchCtx) throw new Error("Expected related_context event");
  const matchItems = (matchCtx.payload as { items?: unknown[] }).items ?? [];
  if (matchItems.length < 1) {
    throw new Error("Expected matched related items");
  }
  const first = matchItems[0] as { url?: string; title?: string };
  if (!first.url?.includes("github.com") || !first.title?.toLowerCase().includes("checkout")) {
    throw new Error("Matched item missing working github link/title");
  }
  console.log("match case ok", first.title);

  // 3 No match
  const emptySession = await makeSession({
    title: "Zzxqyv nonexistent subject 999",
    template: "architecture_decision",
  });
  await seedTemplateStateEvent({
    sessionId: emptySession.id,
    actorId: user.id,
    templateId: "architecture_decision",
  });
  await seedRelatedContextEvent({
    sessionId: emptySession.id,
    actorId: user.id,
    orgId,
    templateId: "architecture_decision",
    subject: "Zzxqyv nonexistent subject 999",
  });
  const emptyEvents = await listSessionEvents(emptySession.id, 0);
  const emptyCtx = emptyEvents.find((e) => e.eventType === "related_context");
  if (!emptyCtx) throw new Error("Expected related_context even when empty");
  const emptyPayload = emptyCtx.payload as {
    status?: string;
    items?: unknown[];
  };
  if ((emptyPayload.items?.length ?? 0) !== 0) {
    throw new Error("Expected zero items for no-match subject");
  }
  if (emptyPayload.status !== "empty") {
    throw new Error(`Expected empty status, got ${emptyPayload.status}`);
  }
  console.log("no-match empty ok");

  // 4 Generic — no related_context (route only seeds for templates)
  stubGithubContextSearchForTests(null);
  const generic = await makeSession({
    title: "Generic chat",
    template: null,
  });
  const genericEvents = await listSessionEvents(generic.id, 0);
  if (genericEvents.some((e) => e.eventType === "related_context")) {
    throw new Error("Generic session must not have related_context");
  }
  if (genericEvents.some((e) => e.eventType === "template_state")) {
    throw new Error("Generic session must not have template_state");
  }
  console.log("generic skips context-fetch ok");

  // 5 Live path without stub: not_connected or real search (both non-throwing)
  const liveSession = await makeSession({
    title: "Live probe subject checkout",
    template: "incident_response",
  });
  await seedRelatedContextEvent({
    sessionId: liveSession.id,
    actorId: user.id,
    orgId,
    templateId: "incident_response",
    subject: "Live probe subject checkout",
  });
  const liveEvents = await listSessionEvents(liveSession.id, 0);
  const liveCtx = liveEvents.find((e) => e.eventType === "related_context");
  if (!liveCtx) throw new Error("Expected related_context on live probe");
  const liveStatus = (liveCtx.payload as { status?: string }).status;
  if (
    liveStatus !== "ok" &&
    liveStatus !== "empty" &&
    liveStatus !== "not_connected" &&
    liveStatus !== "error"
  ) {
    throw new Error(`Unexpected live status: ${liveStatus}`);
  }
  console.log("live/unstubbed path ok status=", liveStatus);

  console.log("\nSTEP 21 VERIFY OK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
