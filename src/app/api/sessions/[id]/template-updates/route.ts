import { jsonError, requireAppUser } from "@/lib/auth";
import { appendSessionEvent } from "@/lib/events";
import { requireSessionPermission } from "@/lib/rbac";
import {
  getSessionTemplate,
  isSessionTemplateId,
} from "@/lib/session-templates";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/sessions/:id/template-updates
 * Body: { field, action, value } — append-only template_update event.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: sessionId } = await context.params;
    const { session } = await requireSessionPermission(
      user,
      sessionId,
      "user_message.write"
    );

    if (!session.sessionTemplate || !isSessionTemplateId(session.sessionTemplate)) {
      return Response.json(
        { error: "Session has no template" },
        { status: 400 }
      );
    }

    const def = getSessionTemplate(session.sessionTemplate);
    if (!def) {
      return Response.json({ error: "Unknown template" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as {
      field?: unknown;
      action?: unknown;
      value?: unknown;
    } | null;

    if (!body || typeof body.field !== "string" || !body.field.trim()) {
      return Response.json({ error: "field is required" }, { status: 400 });
    }
    if (
      body.action !== "add" &&
      body.action !== "add_item" &&
      body.action !== "remove" &&
      body.action !== "set" &&
      body.action !== "toggle_done"
    ) {
      return Response.json(
        { error: "action must be add | add_item | remove | set | toggle_done" },
        { status: 400 }
      );
    }

    const panelIds = new Set(def.panels.map((p) => p.id));
    // Allow known initial field keys too (e.g. severity, recommended_option_id).
    const allowedFields = new Set([
      ...panelIds,
      ...Object.keys(def.initialFields),
    ]);
    if (!allowedFields.has(body.field)) {
      return Response.json(
        { error: `field "${body.field}" is not part of this template` },
        { status: 400 }
      );
    }

    const event = await appendSessionEvent({
      sessionId,
      eventType: "template_update",
      actorId: user.id,
      actorType: "human",
      payload: {
        template: session.sessionTemplate,
        field: body.field,
        action: body.action,
        value: body.value ?? null,
      },
    });

    return Response.json({ event }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
