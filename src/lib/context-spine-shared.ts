/**
 * Client-safe Context Spine types + pure helpers (Feature 2.5 / Step 21).
 * No DB, auth, or GitHub I/O — safe to import from Client Components.
 */
import type { SessionTemplateId } from "@/lib/session-templates";

export type RelatedContextItem = {
  source: "github";
  kind: "issue" | "pull_request";
  id: number;
  number: number;
  title: string;
  url: string;
  repo: string | null;
  state: string;
};

export type RelatedContextPayload = {
  template: SessionTemplateId;
  subject: string;
  keywords: string[];
  source: "github";
  status: "ok" | "empty" | "not_connected" | "error";
  detail?: string;
  items: RelatedContextItem[];
  fetched_at: string;
};

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "that",
  "this",
  "have",
  "has",
  "are",
  "was",
  "were",
  "will",
  "can",
  "our",
  "you",
  "your",
  "incident",
  "response",
  "architecture",
  "decision",
  "session",
  "about",
  "using",
]);

/** Keyword tokens for GitHub title search (simple, not semantic). */
export function extractSearchKeywords(subject: string): string[] {
  const raw = subject
    .toLowerCase()
    .split(/[^a-z0-9/+._-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const unique = [...new Set(raw)];
  return unique.slice(0, 5);
}

export function deriveRelatedContext(
  events: Array<{ eventType: string; payload: Record<string, unknown> }>
): RelatedContextPayload | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.eventType !== "related_context") continue;
    const p = e.payload;
    return {
      template: p.template as SessionTemplateId,
      subject: typeof p.subject === "string" ? p.subject : "",
      keywords: Array.isArray(p.keywords)
        ? p.keywords.filter((k): k is string => typeof k === "string")
        : [],
      source: "github",
      status:
        p.status === "ok" ||
        p.status === "empty" ||
        p.status === "not_connected" ||
        p.status === "error"
          ? p.status
          : "empty",
      detail: typeof p.detail === "string" ? p.detail : undefined,
      items: Array.isArray(p.items)
        ? (p.items as RelatedContextItem[])
        : [],
      fetched_at:
        typeof p.fetched_at === "string"
          ? p.fetched_at
          : new Date(0).toISOString(),
    };
  }
  return null;
}
