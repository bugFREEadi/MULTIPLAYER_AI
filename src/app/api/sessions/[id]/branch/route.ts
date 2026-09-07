import { jsonError, requireAppUser } from "@/lib/auth";
import { createSessionBranch } from "@/lib/branching";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/sessions/:id/branch
 * Body: { fromSequenceNumber: number }
 * Creates a child session forked at that sequence — events are not copied.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    await requireSessionPermission(user, sessionId, "session.branch");

    const body = (await request.json().catch(() => null)) as {
      fromSequenceNumber?: unknown;
    } | null;

    if (
      !body ||
      typeof body.fromSequenceNumber !== "number" ||
      !Number.isInteger(body.fromSequenceNumber)
    ) {
      return Response.json(
        { error: "fromSequenceNumber must be an integer" },
        { status: 400 }
      );
    }

    const { session } = await createSessionBranch({
      parentSessionId: sessionId,
      fromSequenceNumber: body.fromSequenceNumber,
      actor: user,
    });

    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
