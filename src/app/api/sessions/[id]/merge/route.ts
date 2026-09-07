import { jsonError, requireAppUser } from "@/lib/auth";
import { recordBranchMerge } from "@/lib/branching";
import { requireSessionPermission } from "@/lib/rbac";
import { requireSessionAccess } from "@/lib/sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/sessions/:id/merge
 * Body: { sourceSessionId, mergeSummary, rejectedBranches? }
 * `:id` is the target session. Records a human merge decision only.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: targetSessionId } = await context.params;
    await requireSessionPermission(user, targetSessionId, "session.merge");

    const body = (await request.json().catch(() => null)) as {
      sourceSessionId?: unknown;
      mergeSummary?: unknown;
      rejectedBranches?: unknown;
    } | null;

    if (!body || typeof body.sourceSessionId !== "string") {
      return Response.json(
        { error: "sourceSessionId is required" },
        { status: 400 }
      );
    }
    if (typeof body.mergeSummary !== "string") {
      return Response.json(
        { error: "mergeSummary is required" },
        { status: 400 }
      );
    }

    let rejectedBranches: string[] = [];
    if (body.rejectedBranches != null) {
      if (
        !Array.isArray(body.rejectedBranches) ||
        !body.rejectedBranches.every((id) => typeof id === "string")
      ) {
        return Response.json(
          { error: "rejectedBranches must be an array of session ids" },
          { status: 400 }
        );
      }
      rejectedBranches = body.rejectedBranches;
    }

    // Caller must also be a member of the source branch.
    await requireSessionAccess(user, body.sourceSessionId);

    const merge = await recordBranchMerge({
      targetSessionId,
      sourceSessionId: body.sourceSessionId,
      mergedBy: user.id,
      mergeSummary: body.mergeSummary,
      rejectedBranches,
    });

    return Response.json({ merge }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
