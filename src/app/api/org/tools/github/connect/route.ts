import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { buildGithubAuthorizeUrl } from "@/lib/github-oauth";

/** GET /api/org/tools/github/connect — redirect to GitHub OAuth. */
export async function GET() {
  try {
    const user = await requireAppUser();
    if (!user.orgId) {
      throw new AuthError("User has no organization", 400);
    }
    const url = buildGithubAuthorizeUrl(user.orgId);
    return Response.redirect(url, 302);
  } catch (error) {
    return jsonError(error);
  }
}
