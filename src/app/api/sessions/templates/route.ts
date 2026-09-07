import { jsonError, requireAppUser } from "@/lib/auth";
import { listSessionTemplates } from "@/lib/session-templates";

/** GET /api/sessions/templates — registry for the New Session picker. */
export async function GET() {
  try {
    await requireAppUser();
    return Response.json({ templates: listSessionTemplates() });
  } catch (error) {
    return jsonError(error);
  }
}
