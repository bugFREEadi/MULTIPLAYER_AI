import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { createPattern, listOrgPatterns } from "@/lib/patterns";

export async function GET() {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const patterns = await listOrgPatterns(user.orgId);
    return Response.json({ patterns });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      steps?: unknown;
      is_public?: unknown;
    } | null;

    if (!body || typeof body.name !== "string") {
      return Response.json({ error: "name is required" }, { status: 400 });
    }

    const pattern = await createPattern({
      orgId: user.orgId,
      name: body.name,
      steps: body.steps,
      isPublic: body.is_public === true,
    });

    return Response.json({ pattern }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
