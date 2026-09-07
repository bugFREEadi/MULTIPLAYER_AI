import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { curateMemoryFact, serializeFact } from "@/lib/memory";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * PATCH /api/org/memory/:id — approve (curated) or reject a pending fact.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
    } | null;

    if (
      !body ||
      (body.status !== "curated" && body.status !== "rejected")
    ) {
      return Response.json(
        { error: 'status must be "curated" or "rejected"' },
        { status: 400 }
      );
    }

    const fact = await curateMemoryFact({
      orgId: user.orgId,
      factId: id,
      status: body.status,
    });

    return Response.json({ fact: await serializeFact(fact) });
  } catch (error) {
    return jsonError(error);
  }
}
