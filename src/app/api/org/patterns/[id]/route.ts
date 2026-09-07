import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  deletePattern,
  getOrgPattern,
  updatePattern,
} from "@/lib/patterns";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await params;
    const pattern = await getOrgPattern(user.orgId, id);
    if (!pattern) {
      throw new AuthError("Pattern not found", 404);
    }
    return Response.json({ pattern });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      steps?: unknown;
      is_public?: unknown;
    } | null;

    const pattern = await updatePattern(user.orgId, id, {
      name: typeof body?.name === "string" ? body.name : undefined,
      steps: body?.steps !== undefined ? body.steps : undefined,
      isPublic:
        typeof body?.is_public === "boolean" ? body.is_public : undefined,
    });

    return Response.json({ pattern });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await params;
    await deletePattern(user.orgId, id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
