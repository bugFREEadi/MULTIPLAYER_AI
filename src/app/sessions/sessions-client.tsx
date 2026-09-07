"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type SessionRow = {
  id: string;
  title: string | null;
  status: string;
  sessionTemplate?: string | null;
  visibility?: string | null;
  createdAt: string | null;
};

type TemplateInfo = {
  id: string;
  label: string;
  description: string;
};

export default function SessionsPageClient() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [agents, setAgents] = useState<
    Array<{ id: string; name: string; version: string; status: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [patterns, setPatterns] = useState<
    Array<{ id: string; name: string; steps: unknown[] }>
  >([]);
  const [selectedPatternId, setSelectedPatternId] = useState<string>("");
  const [createMode, setCreateMode] = useState<"template" | "pattern">(
    "template"
  );

  const loadSessions = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/sessions");
    const data = (await res.json().catch(() => null)) as {
      sessions?: SessionRow[];
      error?: string;
    } | null;

    if (!res.ok) {
      setError(data?.error ?? `Failed to load sessions (${res.status})`);
      setSessions([]);
      setLoading(false);
      return;
    }

    setSessions(data?.sessions ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/sessions/templates");
      if (!res.ok) return;
      const data = (await res.json()) as { templates?: TemplateInfo[] };
      setTemplates(data.templates ?? []);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/org/agents");
      if (!res.ok) return;
      const data = (await res.json()) as {
        agents?: Array<{
          agent: {
            id: string;
            name: string;
            version: string;
            status: string;
          };
        }>;
      };
      setAgents(
        (data.agents ?? [])
          .map((row) => row.agent)
          .filter((a) => a.status === "active")
      );
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/org/patterns");
      if (!res.ok) return;
      const data = (await res.json()) as {
        patterns?: Array<{ id: string; name: string; steps: unknown[] }>;
      };
      setPatterns(data.patterns ?? []);
    })();
  }, []);

  async function createSession(templateId: string | null) {
    setCreating(true);
    setError(null);
    setPickerOpen(false);
    try {
      const body: {
        title?: string;
        session_template?: string;
        agent_id?: string;
        subject?: string;
      } = {};
      if (templateId) {
        body.session_template = templateId;
        if (subject.trim()) {
          body.subject = subject.trim();
          body.title = subject.trim();
        }
      } else {
        body.title = subject.trim() || "Untitled session";
      }
      if (selectedAgentId) {
        body.agent_id = selectedAgentId;
      }
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        session?: SessionRow;
        error?: string;
      } | null;

      if (!res.ok || !data?.session) {
        setError(data?.error ?? `Failed to create session (${res.status})`);
        setCreating(false);
        return;
      }

      setSessions((prev) => [data.session!, ...prev]);
      router.push(`/sessions/${data.session.id}`);
    } catch {
      setError("Failed to create session");
      setCreating(false);
    }
  }

  async function createFromPattern(patternId: string) {
    setCreating(true);
    setError(null);
    setPickerOpen(false);
    try {
      const res = await fetch(`/api/org/patterns/${patternId}/spin-up`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: subject.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        session?: SessionRow;
        error?: string;
      } | null;
      if (!res.ok || !data?.session) {
        setError(data?.error ?? `Failed to spin up (${res.status})`);
        setCreating(false);
        return;
      }
      setSessions((prev) => [data.session!, ...prev]);
      router.push(`/sessions/${data.session.id}`);
    } catch {
      setError("Failed to spin up from pattern");
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-500">
            <Link href="/" className="hover:underline">
              Multiplayer AI
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/settings/analytics"
            className="text-sm text-neutral-600 hover:underline"
          >
            Analytics
          </Link>
          <Link
            href="/settings/patterns"
            className="text-sm text-neutral-600 hover:underline"
          >
            Patterns
          </Link>
          <Link
            href="/settings/agents"
            className="text-sm text-neutral-600 hover:underline"
          >
            Agents
          </Link>
          <Link
            href="/settings/memory"
            className="text-sm text-neutral-600 hover:underline"
          >
            Memory
          </Link>
          <Link
            href="/settings/tools"
            className="text-sm text-neutral-600 hover:underline"
          >
            Tools
          </Link>
          <Link
            href="/settings/budget"
            className="text-sm text-neutral-600 hover:underline"
          >
            Budget
          </Link>
          <Link
            href="/settings/policies"
            className="text-sm text-neutral-600 hover:underline"
          >
            Policies
          </Link>
          <button
            type="button"
            data-testid="new-session"
            onClick={() => {
              setSelectedTemplate("");
              setSelectedAgentId("");
              setSelectedPatternId("");
              setCreateMode("template");
              setSubject("");
              setPickerOpen(true);
            }}
            disabled={creating}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {creating ? "Creating…" : "New Session"}
          </button>
          <UserButton />
        </div>
      </header>

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {pickerOpen ? (
        <div
          data-testid="template-picker"
          className="mb-6 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-4"
        >
          <h2 className="text-sm font-semibold text-neutral-900">
            Choose a session type
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Templates add structured panels; patterns pre-wire agent +
            checkpoint scaffold from the library.
          </p>
          <div className="mt-3 flex gap-2 text-sm">
            <button
              type="button"
              data-testid="create-mode-template"
              className={
                createMode === "template"
                  ? "rounded-md bg-neutral-900 px-3 py-1 text-white"
                  : "rounded-md border border-neutral-300 bg-white px-3 py-1"
              }
              onClick={() => setCreateMode("template")}
            >
              Template / generic
            </button>
            <button
              type="button"
              data-testid="create-mode-pattern"
              className={
                createMode === "pattern"
                  ? "rounded-md bg-neutral-900 px-3 py-1 text-white"
                  : "rounded-md border border-neutral-300 bg-white px-3 py-1"
              }
              onClick={() => setCreateMode("pattern")}
            >
              From pattern
            </button>
          </div>

          {createMode === "pattern" ? (
            <div className="mt-3 space-y-2" data-testid="pattern-picker">
              {patterns.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  No patterns yet.{" "}
                  <Link href="/settings/patterns" className="underline">
                    Create one in the Pattern library
                  </Link>
                  .
                </p>
              ) : (
                patterns.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-start gap-2 rounded border border-neutral-200 bg-white px-3 py-2"
                  >
                    <input
                      type="radio"
                      name="pattern"
                      checked={selectedPatternId === p.id}
                      onChange={() => setSelectedPatternId(p.id)}
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {p.name}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {(p.steps ?? []).length} step
                        {(p.steps ?? []).length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          ) : (
          <div className="mt-3 space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded border border-neutral-200 bg-white px-3 py-2">
              <input
                type="radio"
                name="template"
                checked={selectedTemplate === ""}
                onChange={() => setSelectedTemplate("")}
              />
              <span>
                <span className="block text-sm font-medium">Generic</span>
                <span className="text-xs text-neutral-500">
                  Plain multiplayer chat — no extra panels.
                </span>
              </span>
            </label>
            {templates.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-start gap-2 rounded border border-neutral-200 bg-white px-3 py-2"
              >
                <input
                  type="radio"
                  name="template"
                  checked={selectedTemplate === t.id}
                  onChange={() => setSelectedTemplate(t.id)}
                />
                <span>
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="text-xs text-neutral-500">
                    {t.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
          )}
          <label className="mt-4 block text-sm">
            <span className="font-medium text-neutral-800">
              Subject / description
            </span>
            <input
              data-testid="session-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={
                createMode === "pattern"
                  ? "Optional session title"
                  : selectedTemplate
                    ? "e.g. checkout latency spike — matches GitHub issues/PRs"
                    : "Optional title"
              }
              className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          {createMode === "template" ? (
          <label className="mt-4 block text-sm">
            <span className="font-medium text-neutral-800">Agent (optional)</span>
            <select
              data-testid="agent-picker"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="mt-1 w-full border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">None — no agent_runs tracking</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} v{a.version}
                </option>
              ))}
            </select>
            {agents.length === 0 ? (
              <span className="mt-1 block text-xs text-neutral-500">
                Register agents under{" "}
                <Link href="/settings/agents" className="underline">
                  Agent Fleet
                </Link>
                .
              </span>
            ) : null}
          </label>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              data-testid="create-session-confirm"
              disabled={
                creating ||
                (createMode === "pattern" && !selectedPatternId)
              }
              onClick={() => {
                if (createMode === "pattern") {
                  void createFromPattern(selectedPatternId);
                } else {
                  void createSession(selectedTemplate || null);
                }
              }}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              disabled={creating}
              onClick={() => setPickerOpen(false)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-300 px-6 py-12 text-center">
          <p className="text-neutral-700">No sessions yet.</p>
          <p className="mt-1 text-sm text-neutral-500">
            Create one to start a shared AI work session.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-200 border border-neutral-200">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/sessions/${session.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50"
              >
                <div>
                  <p className="font-medium text-neutral-900">
                    {session.title?.trim() || "Untitled session"}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {session.status}
                    {session.visibility === "client_facing"
                      ? " · client-facing"
                      : " · internal"}
                    {session.sessionTemplate
                      ? ` · ${session.sessionTemplate}`
                      : " · generic"}
                    {session.createdAt
                      ? ` · ${new Date(session.createdAt).toLocaleString()}`
                      : null}
                  </p>
                </div>
                <span className="text-xs text-neutral-400">Open</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
