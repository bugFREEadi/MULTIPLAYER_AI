"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type PublicTool = {
  id: string;
  toolName: string;
  status: string;
  permission: "allowed" | "restricted" | "requires_checkpoint";
  agentPermissions?: Array<{
    agentId: string;
    permission: "allowed" | "restricted" | "requires_checkpoint";
  }>;
  connected: boolean;
  accountLogin: string | null;
};

type Available = {
  toolName: string;
  oauthConfigured: boolean;
};

export default function ToolsClient() {
  const [tools, setTools] = useState<PublicTool[]>([]);
  const [available, setAvailable] = useState<Available[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/org/tools");
    const data = (await res.json().catch(() => null)) as {
      tools?: PublicTool[];
      available?: Available[];
      error?: string;
    } | null;
    if (!res.ok) {
      setError(data?.error ?? `Failed to load (${res.status})`);
      setLoading(false);
      return;
    }
    setTools(data?.tools ?? []);
    setAvailable(data?.available ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const login = params.get("login");
    const err = params.get("error");
    if (connected && login) {
      setBanner(`Connected ${connected} as @${login}`);
    } else if (err) {
      setError(err);
    }
  }, []);

  async function ensureGithub() {
    setBusyId("ensure-github");
    setError(null);
    try {
      const res = await fetch("/api/org/tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool_name: "github" }),
      });
      const data = (await res.json().catch(() => null)) as {
        tools?: PublicTool[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Failed (${res.status})`);
      }
      setTools(data?.tools ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  async function setPermission(
    tool: PublicTool,
    permission: PublicTool["permission"]
  ) {
    setBusyId(tool.id);
    setError(null);
    try {
      const res = await fetch(`/api/org/tools/${tool.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permission }),
      });
      const data = (await res.json().catch(() => null)) as {
        tools?: PublicTool[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Failed (${res.status})`);
      }
      setTools(data?.tools ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(tool: PublicTool) {
    setBusyId(tool.id);
    setError(null);
    try {
      const res = await fetch(`/api/org/tools/${tool.id}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as {
        tools?: PublicTool[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Failed (${res.status})`);
      }
      setTools(data?.tools ?? []);
      setBanner("GitHub disconnected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  const github = tools.find((t) => t.toolName === "github");
  const githubAvailable = available.find((a) => a.toolName === "github");

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <header className="mb-8">
        <Link href="/sessions" className="text-sm text-neutral-500 hover:underline">
          ← Sessions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Tool Mesh</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Connect org tools and set invocation permissions. GitHub is the first
          connector — Notion/Linear/Slack come later.
        </p>
      </header>

      {banner ? (
        <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {banner}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <section
          data-testid="tool-mesh-panel"
          className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                GitHub
              </h2>
              <p className="mt-1 text-sm text-neutral-800">
                {github?.connected
                  ? `Connected as @${github.accountLogin ?? "unknown"}`
                  : "Not connected"}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {githubAvailable?.oauthConfigured
                  ? "OAuth app configured"
                  : "Set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET to enable Connect"}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {!github ? (
                <button
                  type="button"
                  disabled={busyId === "ensure-github"}
                  onClick={() => void ensureGithub()}
                  className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs disabled:opacity-50"
                >
                  Add GitHub tool
                </button>
              ) : null}
              {github && !github.connected && githubAvailable?.oauthConfigured ? (
                <a
                  href="/api/org/tools/github/connect"
                  className="rounded-md bg-neutral-900 px-2.5 py-1 text-xs text-white"
                >
                  Connect GitHub
                </a>
              ) : null}
              {github?.connected ? (
                <button
                  type="button"
                  disabled={busyId === github.id}
                  onClick={() => void disconnect(github)}
                  className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs text-rose-900 disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          </div>

          {github ? (
            <div className="mt-4 border-t border-neutral-200 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Permission
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    "allowed",
                    "restricted",
                    "requires_checkpoint",
                  ] as const
                ).map((perm) => (
                  <button
                    key={perm}
                    type="button"
                    data-testid={`permission-${perm}`}
                    disabled={busyId === github.id}
                    onClick={() => void setPermission(github, perm)}
                    className={`rounded-md px-2.5 py-1 text-xs disabled:opacity-50 ${
                      github.permission === perm
                        ? "bg-neutral-900 text-white"
                        : "border border-neutral-300 bg-white text-neutral-800"
                    }`}
                  >
                    {perm}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                Mock tool calls use{" "}
                <code className="rounded bg-neutral-200 px-1">
                  [mock_tool:github]
                </code>{" "}
                in a message to exercise this gate.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-neutral-600">
              Add the GitHub tool to configure permissions (works before OAuth for
              mock gating tests).
            </p>
          )}
        </section>
      )}

      <p className="mt-6 text-sm text-neutral-500">
        Also see{" "}
        <Link href="/settings/agents" className="underline">
          Agent Fleet
        </Link>
        ,{" "}
        <Link href="/settings/budget" className="underline">
          Budget
        </Link>{" "}
        and{" "}
        <Link href="/settings/policies" className="underline">
          Checkpoint policies
        </Link>
        .
      </p>
    </main>
  );
}
