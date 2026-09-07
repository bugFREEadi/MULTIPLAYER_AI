import "server-only";

/**
 * Server-only Context Spine — GitHub fetch + event injection (Feature 2.5 / Step 21).
 * Client Components must import pure helpers from `@/lib/context-spine-shared`.
 */
import { appendSessionEvent } from "@/lib/events";
import type { SessionTemplateId } from "@/lib/session-templates";
import { getGithubAccessToken } from "@/lib/tool-mesh";
import {
  extractSearchKeywords,
  type RelatedContextItem,
  type RelatedContextPayload,
} from "@/lib/context-spine-shared";

export type { RelatedContextItem, RelatedContextPayload };
export {
  deriveRelatedContext,
  extractSearchKeywords,
} from "@/lib/context-spine-shared";

type GithubSearchIssue = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  pull_request?: unknown;
  repository_url?: string;
};

/**
 * Override for tests — when set, skip live GitHub and return this payload's items.
 */
let testStub:
  | ((opts: {
      subject: string;
      keywords: string[];
    }) => RelatedContextItem[] | Promise<RelatedContextItem[]>)
  | null = null;

export function stubGithubContextSearchForTests(
  fn:
    | ((opts: {
        subject: string;
        keywords: string[];
      }) => RelatedContextItem[] | Promise<RelatedContextItem[]>)
    | null
) {
  testStub = fn;
}

function repoFromUrl(repositoryUrl: string | undefined): string | null {
  if (!repositoryUrl) return null;
  const m = repositoryUrl.match(/repos\/([^/]+\/[^/]+)$/);
  return m?.[1] ?? null;
}

export async function searchGithubRelatedContext(opts: {
  orgId: string;
  subject: string;
  limit?: number;
}): Promise<{
  items: RelatedContextItem[];
  status: "ok" | "empty" | "not_connected" | "error";
  detail?: string;
  keywords: string[];
}> {
  const keywords = extractSearchKeywords(opts.subject);
  const limit = opts.limit ?? 8;

  if (testStub) {
    const items = await testStub({ subject: opts.subject, keywords });
    return {
      items: items.slice(0, limit),
      status: items.length === 0 ? "empty" : "ok",
      keywords,
    };
  }

  if (keywords.length === 0) {
    return {
      items: [],
      status: "empty",
      detail: "No searchable keywords in subject",
      keywords,
    };
  }

  const token = await getGithubAccessToken(opts.orgId);
  if (!token) {
    return {
      items: [],
      status: "not_connected",
      detail: "GitHub is not connected for this org",
      keywords,
    };
  }

  // Prefer the strongest keyword; GitHub search quality drops with many OR clauses.
  const q = `${keywords[0]} in:title`;
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${limit}&sort=updated`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "multiplayer-ai-context-spine",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        items: [],
        status: "error",
        detail: `GitHub search failed (${res.status}): ${text.slice(0, 200)}`,
        keywords,
      };
    }
    const json = (await res.json()) as { items?: GithubSearchIssue[] };
    const items: RelatedContextItem[] = (json.items ?? []).map((issue) => ({
      source: "github" as const,
      kind: issue.pull_request ? ("pull_request" as const) : ("issue" as const),
      id: issue.id,
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      repo: repoFromUrl(issue.repository_url),
      state: issue.state,
    }));

    // Secondary filter: prefer items whose title overlaps any keyword
    const filtered = items.filter((item) => {
      const t = item.title.toLowerCase();
      return keywords.some((k) => t.includes(k));
    });
    const finalItems = filtered.length > 0 ? filtered : items;

    return {
      items: finalItems,
      status: finalItems.length === 0 ? "empty" : "ok",
      keywords,
    };
  } catch (error) {
    return {
      items: [],
      status: "error",
      detail: error instanceof Error ? error.message : "GitHub search error",
      keywords,
    };
  }
}

/**
 * Fetch-at-creation context spine for templated sessions.
 * Always writes a related_context event (even when empty / not connected)
 * so the UI can show a stable empty state.
 */
export async function seedRelatedContextEvent(opts: {
  sessionId: string;
  actorId: string | null;
  orgId: string;
  templateId: SessionTemplateId;
  subject: string;
}) {
  const result = await searchGithubRelatedContext({
    orgId: opts.orgId,
    subject: opts.subject,
  });

  const payload: RelatedContextPayload = {
    template: opts.templateId,
    subject: opts.subject,
    keywords: result.keywords,
    source: "github",
    status: result.status,
    detail: result.detail,
    items: result.items,
    fetched_at: new Date().toISOString(),
  };

  return appendSessionEvent({
    sessionId: opts.sessionId,
    eventType: "related_context",
    actorId: opts.actorId,
    actorType: "agent",
    payload,
  });
}
