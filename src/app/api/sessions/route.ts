import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessionMembers, sessions } from "@/db/schema";
import { AuthError, jsonError, requireAppUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }

    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.orgId, user.orgId))
      .orderBy(desc(sessions.createdAt));

    return Response.json({ sessions: rows });
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

    let title: string | null = null;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as {
        title?: unknown;
      } | null;
      if (body?.title != null) {
        if (typeof body.title !== "string") {
          return Response.json({ error: "title must be a string" }, { status: 400 });
        }
        title = body.title.trim() || null;
      }
    }

    const created = await db.transaction(async (tx) => {
      const [session] = await tx
        .insert(sessions)
        .values({
          orgId: user.orgId,
          title,
          createdBy: user.id,
          status: "active",
          visibility: "internal_only",
        })
        .returning();

      await tx.insert(sessionMembers).values({
        sessionId: session.id,
        userId: user.id,
        role: "owner",
      });

      return session;
    });

    return Response.json({ session: created }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
