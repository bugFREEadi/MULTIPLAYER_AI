"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function GuestInviteRedeemPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Redeeming guest invite…");

  useEffect(() => {
    const token = params.token;
    if (!token) return;
    void (async () => {
      try {
        const res = await fetch(`/api/guest/redeem/${token}`, {
          method: "POST",
        });
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          redirectTo?: string;
        } | null;
        if (!res.ok || !data?.redirectTo) {
          setError(data?.error ?? `Invite failed (${res.status})`);
          setStatus("Could not join");
          return;
        }
        setStatus("Joined — opening session…");
        router.replace(data.redirectTo);
      } catch {
        setError("Network error redeeming invite");
        setStatus("Could not join");
      }
    })();
  }, [params.token, router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-amber-800">
        Guest access
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{status}</h1>
      <p className="mt-2 text-sm text-neutral-600">
        No Clerk account required — this link is a time-limited magic token.
      </p>
      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </main>
  );
}
