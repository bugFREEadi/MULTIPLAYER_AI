import Link from "next/link";
import SessionsPageClient from "./sessions-client";

function hasRealClerkKeys() {
  return (
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    Boolean(process.env.CLERK_SECRET_KEY) &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.includes("placeholder") &&
    !process.env.CLERK_SECRET_KEY?.includes("placeholder")
  );
}

export default function SessionsPage() {
  if (!hasRealClerkKeys()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Sessions unavailable</h1>
        <p className="text-neutral-600">
          Step 5 requires Clerk browser auth. Add keys to{" "}
          <code>.env.local</code> and restart the dev server.
        </p>
        <Link href="/" className="text-sm underline">
          ← Home
        </Link>
      </main>
    );
  }

  return <SessionsPageClient />;
}
