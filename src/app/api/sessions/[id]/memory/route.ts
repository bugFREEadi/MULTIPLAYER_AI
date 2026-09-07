import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  buildSessionContextText,
  retrieveMemoryForSession,
  runMemoryExtraction,
  serializeFact,
} from "@/lib/memory";
import { requireSessionPermission } from "@/lib/rbac";
import { requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/sessions/:id/memory — recall curated facts for current session context.
 * Any session member may view recalled memory.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    const { session } = await requireSessionAccess(user, sessionId);
    if (!session.orgId) {
      throw new AuthError("Session has no organization", 400);
    }

    const contextText = await buildSessionContextText(sessionId);
    const facts = await retrieveMemoryForSession({
      orgId: session.orgId,
      sessionId,
      userId: user.id,
      contextText: contextText || session.title || "session",
    });

    return Response.json({
      facts,
      contextPreview: contextText.slice(0, 240),
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST /api/sessions/:id/memory — run extraction for this session (on-demand).
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "session.handoff");

    const result = await runMemoryExtraction(sessionId);
    return Response.json({
      inserted: await Promise.all(result.inserted.map(serializeFact)),
      skippedExisting: result.skippedExisting,
      candidateCount: result.candidateCount,
    });
  } catch (error) {
    return jsonError(error);
  }
}
