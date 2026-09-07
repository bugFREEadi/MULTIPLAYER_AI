import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth";
import {
  GUEST_COOKIE_NAME,
  redeemGuestInvite,
} from "@/lib/guest-auth";

type RouteContext = {
  params: Promise<{ token: string }>;
};

/**
 * POST /api/guest/redeem/:token — magic-link redeem (no Clerk).
 * Sets httpOnly guest cookie scoped to one session.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    const result = await redeemGuestInvite(token);

    const response = NextResponse.json({
      sessionId: result.sessionId,
      userId: result.user.id,
      expiresAt: result.expiresAt.toISOString(),
      redirectTo: `/guest/s/${result.sessionId}`,
    });

    response.cookies.set(GUEST_COOKIE_NAME, result.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: result.expiresAt,
    });

    return response;
  } catch (error) {
    return jsonError(error);
  }
}
