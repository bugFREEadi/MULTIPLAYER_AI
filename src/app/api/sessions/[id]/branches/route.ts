import { jsonError, requireAppUser } from "@/lib/auth";
import { listChildBranches, listMergesForSession } from "@/lib/branching";
import { requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** GET /api/sessions/:id/branches — child branches + merges involving this session. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionAccess(user, sessionId);

    const [branches, merges] = await Promise.all([
      listChildBranches(sessionId),
      listMergesForSession(sessionId),
    ]);

    return Response.json({ branches, merges });
  } catch (error) {
    return jsonError(error);
  }
}
