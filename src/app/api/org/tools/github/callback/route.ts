import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { completeGithubOAuth } from "@/lib/github-oauth";

/**
 * GET /api/org/tools/github/callback?code=&state=
 * Exchanges the code, stores encrypted tokens, redirects to Tool Mesh settings.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const oauthError = searchParams.get("error");

    if (oauthError) {
      const desc = searchParams.get("error_description") || oauthError;
      return Response.redirect(
        new URL(
          `/settings/tools?error=${encodeURIComponent(desc)}`,
          request.url
        ),
        302
      );
    }

    if (!code || !state) {
      throw new AuthError("Missing code or state", 400);
    }

    const { login } = await completeGithubOAuth({
      code,
      state,
      expectedOrgId: user.orgId,
    });

    return Response.redirect(
      new URL(
        `/settings/tools?connected=github&login=${encodeURIComponent(login)}`,
        request.url
      ),
      302
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.redirect(
        new URL(
          `/settings/tools?error=${encodeURIComponent(error.message)}`,
          request.url
        ),
        302
      );
    }
    return jsonError(error);
  }
}
