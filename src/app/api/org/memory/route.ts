import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  listOrgMemoryFacts,
  listPendingMemoryFacts,
  serializeFact,
} from "@/lib/memory";

/**
 * GET /api/org/memory — pending (default) or filtered memory facts for curation.
 * Query: ?status=pending|curated|rejected|all
 */
export async function GET(request: Request) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "pending";

    if (status === "all") {
      const facts = await listOrgMemoryFacts(user.orgId);
      return Response.json({
        facts: await Promise.all(facts.map(serializeFact)),
      });
    }

    if (status === "pending") {
      const facts = await listPendingMemoryFacts(user.orgId);
      return Response.json({
        facts: await Promise.all(facts.map(serializeFact)),
      });
    }

    if (status !== "curated" && status !== "rejected") {
      return Response.json(
        { error: 'status must be pending | curated | rejected | all' },
        { status: 400 }
      );
    }

    const facts = await listOrgMemoryFacts(user.orgId, status);
    return Response.json({
      facts: await Promise.all(facts.map(serializeFact)),
    });
  } catch (error) {
    return jsonError(error);
  }
}
