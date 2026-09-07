import { createHash, randomBytes } from "crypto";
import { AuthError } from "@/lib/auth-error";
import { storeGithubConnection } from "@/lib/tool-mesh";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";

function appBaseUrl() {
  return (
    process.env.APP_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

export function githubOAuthConfigured() {
  return Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() &&
      process.env.GITHUB_CLIENT_SECRET?.trim()
  );
}

export function githubCallbackUrl() {
  return `${appBaseUrl()}/api/org/tools/github/callback`;
}

/** Signed-ish state: orgId + nonce + hmac-ish digest with client secret. */
export function createGithubOAuthState(orgId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const secret =
    process.env.GITHUB_CLIENT_SECRET ||
    process.env.TOOL_AUTH_ENCRYPTION_KEY ||
    "dev";
  const payload = `${orgId}.${nonce}`;
  const sig = createHash("sha256")
    .update(`${payload}.${secret}`)
    .digest("hex")
    .slice(0, 24);
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function parseGithubOAuthState(state: string): { orgId: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new AuthError("Invalid OAuth state", 400);
  }
  const parts = decoded.split(".");
  if (parts.length !== 3) {
    throw new AuthError("Invalid OAuth state", 400);
  }
  const [orgId, nonce, sig] = parts;
  const secret =
    process.env.GITHUB_CLIENT_SECRET ||
    process.env.TOOL_AUTH_ENCRYPTION_KEY ||
    "dev";
  const expected = createHash("sha256")
    .update(`${orgId}.${nonce}.${secret}`)
    .digest("hex")
    .slice(0, 24);
  if (sig !== expected) {
    throw new AuthError("Invalid OAuth state signature", 400);
  }
  return { orgId };
}

export function buildGithubAuthorizeUrl(orgId: string): string {
  if (!githubOAuthConfigured()) {
    throw new AuthError(
      "GitHub OAuth is not configured — set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET",
      503
    );
  }
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: githubCallbackUrl(),
    scope: "read:user",
    state: createGithubOAuthState(orgId),
  });
  return `${GITHUB_AUTHORIZE}?${params.toString()}`;
}

export async function completeGithubOAuth(opts: {
  code: string;
  state: string;
  expectedOrgId: string;
}) {
  const { orgId } = parseGithubOAuthState(opts.state);
  if (orgId !== opts.expectedOrgId) {
    throw new AuthError("OAuth state org mismatch", 403);
  }
  if (!githubOAuthConfigured()) {
    throw new AuthError("GitHub OAuth is not configured", 503);
  }

  const tokenRes = await fetch(GITHUB_TOKEN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: opts.code,
      redirect_uri: githubCallbackUrl(),
    }),
  });

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new AuthError(
      tokenJson.error_description ||
        tokenJson.error ||
        "GitHub token exchange failed",
      400
    );
  }

  const userRes = await fetch(GITHUB_USER, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "multiplayer-ai",
    },
  });
  const userJson = (await userRes.json()) as {
    id?: number;
    login?: string;
    message?: string;
  };
  if (!userRes.ok || !userJson.login || userJson.id == null) {
    throw new AuthError(
      userJson.message || "Failed to fetch GitHub user",
      400
    );
  }

  const tool = await storeGithubConnection({
    orgId,
    accessToken: tokenJson.access_token,
    tokenType: tokenJson.token_type,
    scope: tokenJson.scope,
    login: userJson.login,
    githubUserId: userJson.id,
  });

  return { tool, login: userJson.login };
}
