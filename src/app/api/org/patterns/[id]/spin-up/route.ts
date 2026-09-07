import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { spinUpSessionFromPattern } from "@/lib/patterns";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const { id } = await params;

    let title: string | null = null;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as {
        title?: unknown;
      } | null;
      if (body?.title != null) {
        if (typeof body.title !== "string") {
          return Response.json(
            { error: "title must be a string" },
            { status: 400 }
          );
        }
        title = body.title.trim() || null;
      }
    }

    const { session, pattern } = await spinUpSessionFromPattern({
      orgId: user.orgId,
      userId: user.id,
      patternId: id,
      title,
    });

    return Response.json({ session, pattern }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
