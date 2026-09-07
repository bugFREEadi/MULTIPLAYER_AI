import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { getOrgAnalytics } from "@/lib/analytics";

/**
 * GET /api/org/analytics?days=30 — Session Intelligence aggregations (Step 24).
 */
export async function GET(request: Request) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }

    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get("days");
    let days = 30;
    if (daysParam != null && daysParam !== "") {
      const n = Number(daysParam);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return Response.json(
          { error: "days must be an integer between 1 and 365" },
          { status: 400 }
        );
      }
      days = n;
    }

    const analytics = await getOrgAnalytics(user.orgId, { days });
    return Response.json({ analytics });
  } catch (error) {
    return jsonError(error);
  }
}
