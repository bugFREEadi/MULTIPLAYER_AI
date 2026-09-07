import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { sessionMembers, sessions } from "@/db/schema";
import { getOrgAgent } from "@/lib/agents";
import {
  AuthError,
  jsonError,
  requireActor,
  requireAppUser,
} from "@/lib/auth";
import { assertOrgBudgetAllowsNewWork } from "@/lib/budget";
import { seedRelatedContextEvent } from "@/lib/context-spine";
import { isGuestClerkId } from "@/lib/guest-auth";
import {
  isSessionTemplateId,
  SESSION_TEMPLATES,
} from "@/lib/session-templates";
import { seedTemplateStateEvent } from "@/lib/session-template-seed";

export async function GET() {
  try {
    const actor = await requireActor();

    if (actor.guestSessionId || isGuestClerkId(actor.user.clerkId)) {
      if (!actor.guestSessionId) {
        return Response.json({ sessions: [] });
      }
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, actor.guestSessionId))
        .limit(1);
      if (!session || session.visibility === "internal_only") {
        return Response.json({ sessions: [] });
      }
      return Response.json({ sessions: [session] });
    }

    if (!actor.user.orgId) {
      throw new AuthError("User has no organization", 400);
    }

    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.orgId, actor.user.orgId))
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

    await assertOrgBudgetAllowsNewWork(user.orgId);

    let title: string | null = null;
    let sessionTemplate: string | null = null;
    let agentId: string | null = null;
    let subject: string | null = null;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as {
        title?: unknown;
        session_template?: unknown;
        agent_id?: unknown;
        subject?: unknown;
      } | null;
      if (body?.title != null) {
        if (typeof body.title !== "string") {
          return Response.json({ error: "title must be a string" }, { status: 400 });
        }
        title = body.title.trim() || null;
      }
      if (body?.subject != null) {
        if (typeof body.subject !== "string") {
          return Response.json(
            { error: "subject must be a string" },
            { status: 400 }
          );
        }
        subject = body.subject.trim() || null;
      }
      if (body?.session_template != null && body.session_template !== "") {
        if (!isSessionTemplateId(body.session_template)) {
          return Response.json(
            {
              error:
                'session_template must be "incident_response", "architecture_decision", or null',
            },
            { status: 400 }
          );
        }
        sessionTemplate = body.session_template;
        if (!title) {
          title = subject || SESSION_TEMPLATES[body.session_template].defaultTitle;
        }
      }
      if (body?.agent_id != null && body.agent_id !== "") {
        if (typeof body.agent_id !== "string") {
          return Response.json(
            { error: "agent_id must be a string" },
            { status: 400 }
          );
        }
        const agent = await getOrgAgent(user.orgId, body.agent_id);
        if (!agent || agent.status !== "active") {
          return Response.json(
            { error: "agent_id must reference an active org agent" },
            { status: 400 }
          );
        }
        agentId = agent.id;
      }
    }

    const contextSubject =
      subject || title || (sessionTemplate ? SESSION_TEMPLATES[
        sessionTemplate as keyof typeof SESSION_TEMPLATES
      ]?.defaultTitle : null);

    const created = await db.transaction(async (tx) => {
      const [session] = await tx
        .insert(sessions)
        .values({
          orgId: user.orgId,
          title: title || contextSubject,
          sessionTemplate,
          agentId,
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

    if (sessionTemplate && isSessionTemplateId(sessionTemplate)) {
      await seedTemplateStateEvent({
        sessionId: created.id,
        actorId: user.id,
        templateId: sessionTemplate,
      });
      await seedRelatedContextEvent({
        sessionId: created.id,
        actorId: user.id,
        orgId: user.orgId,
        templateId: sessionTemplate,
        subject:
          contextSubject || SESSION_TEMPLATES[sessionTemplate].defaultTitle,
      });
    }

    return Response.json({ session: created }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
