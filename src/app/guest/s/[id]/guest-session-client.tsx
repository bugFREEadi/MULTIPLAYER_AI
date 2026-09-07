"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import SessionViewClient from "@/app/sessions/[id]/session-view-client";

/**
 * Guest shell around the shared session view.
 * Auth is the mp_guest_session cookie only — no Clerk UserButton.
 */
export default function GuestSessionClient({
  sessionId,
}: {
  sessionId: string;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const probe = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}`);
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      membership?: { role?: string };
      actorKind?: string;
    } | null;
    if (!res.ok) {
      setError(data?.error ?? `Access denied (${res.status})`);
      setReady(false);
      return;
    }
    if (data?.actorKind !== "guest") {
      setError(
        "This page is for guest magic-link access. Sign in as a team member via /sessions instead."
      );
      setReady(false);
      return;
    }
    setRole(data.membership?.role ?? null);
    setReady(true);
  }, [sessionId]);

  useEffect(() => {
    void probe();
  }, [probe]);

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-amber-800">
          Guest access denied
        </p>
        <p className="mt-3 text-sm text-red-700">{error}</p>
        <p className="mt-4 text-sm text-neutral-600">
          Your invite may have expired, or this link is not valid for this
          session.
        </p>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <p className="text-sm text-neutral-500">Checking guest access…</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-amber-50/40">
      <div
        data-testid="guest-banner"
        className="border-b-2 border-amber-500 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950"
      >
        You are viewing as a <strong>guest</strong>
        {role ? ` (${role})` : ""} — no team account.{" "}
        <Link href="/sessions" className="underline">
          Team sign-in
        </Link>
      </div>
      <SessionViewClient sessionId={sessionId} />
    </div>
  );
}
