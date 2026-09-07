import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import {
  evaluateOrgBudget,
  getOrgBudgetStatus,
  upsertBudgetLimit,
} from "@/lib/budget";

/**
 * GET /api/org/budget — current month spend vs limit + alert/soft-lock flags.
 * PUT — upsert budget_limits for the caller's org.
 */
export async function GET() {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const status = await getOrgBudgetStatus(user.orgId);
    return Response.json({ budget: status });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }

    const body = (await request.json().catch(() => null)) as {
      monthly_limit_usd?: unknown;
      alert_threshold_pct?: unknown;
    } | null;

    if (
      !body ||
      (typeof body.monthly_limit_usd !== "number" &&
        typeof body.monthly_limit_usd !== "string")
    ) {
      return Response.json(
        { error: "monthly_limit_usd is required" },
        { status: 400 }
      );
    }

    const limit = await upsertBudgetLimit({
      orgId: user.orgId,
      monthlyLimitUsd: body.monthly_limit_usd,
      alertThresholdPct:
        typeof body.alert_threshold_pct === "number"
          ? body.alert_threshold_pct
          : undefined,
    });

    const status = await getOrgBudgetStatus(user.orgId);
    return Response.json({ limit, budget: status });
  } catch (error) {
    return jsonError(error);
  }
}

/** POST — run the same evaluation the scheduled job uses (for tests / manual refresh). */
export async function POST() {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const limit = await evaluateOrgBudget(user.orgId);
    const status = await getOrgBudgetStatus(user.orgId);
    return Response.json({ limit, budget: status });
  } catch (error) {
    return jsonError(error);
  }
}
