"use client";

import {
  deriveRelatedContext,
  type RelatedContextItem,
  type RelatedContextPayload,
} from "@/lib/context-spine-shared";

type SessionEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export function RelatedContextPanel({
  events,
}: {
  events: SessionEvent[];
}) {
  const ctx = deriveRelatedContext(events);
  if (!ctx) return null;

  return (
    <section
      data-testid="related-context-panel"
      className="mb-3 rounded-md border border-sky-200 bg-sky-50/70 px-3 py-2"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-sky-900">
        Related context
      </h2>
      <p className="mt-1 text-xs text-sky-800/80">
        Auto-fetched from GitHub at session creation
        {ctx.subject ? ` · subject: “${ctx.subject}”` : ""}
        {ctx.keywords.length > 0
          ? ` · keywords: ${ctx.keywords.join(", ")}`
          : ""}
      </p>
      <RelatedContextBody ctx={ctx} />
    </section>
  );
}

function RelatedContextBody({ ctx }: { ctx: RelatedContextPayload }) {
  if (ctx.status === "not_connected") {
    return (
      <p className="mt-2 text-sm text-sky-900/80" data-testid="related-context-empty">
        GitHub is not connected — connect it under Settings → Tools to surface
        related issues and PRs.
        {ctx.detail ? ` (${ctx.detail})` : ""}
      </p>
    );
  }

  if (ctx.status === "error") {
    return (
      <p className="mt-2 text-sm text-rose-800" data-testid="related-context-empty">
        Could not fetch related context
        {ctx.detail ? `: ${ctx.detail}` : "."}
      </p>
    );
  }

  if (ctx.status === "empty" || ctx.items.length === 0) {
    return (
      <p className="mt-2 text-sm text-sky-900/80" data-testid="related-context-empty">
        No related context found.
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-1.5" data-testid="related-context-list">
      {ctx.items.map((item) => (
        <RelatedContextRow key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </ul>
  );
}

function RelatedContextRow({ item }: { item: RelatedContextItem }) {
  const label = item.kind === "pull_request" ? "PR" : "Issue";
  return (
    <li className="text-sm text-sky-950">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline"
        data-testid={`related-context-link-${item.number}`}
      >
        {label} #{item.number}: {item.title}
      </a>
      <span className="ml-2 text-xs text-sky-800">
        {item.repo ?? "github"} · {item.state}
      </span>
    </li>
  );
}
