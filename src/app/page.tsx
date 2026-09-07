import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

function hasRealClerkKeys() {
  return (
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    Boolean(process.env.CLERK_SECRET_KEY) &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.includes("placeholder") &&
    !process.env.CLERK_SECRET_KEY?.includes("placeholder")
  );
}

export default async function HomePage() {
  if (!hasRealClerkKeys()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Multiplayer AI</h1>
        <p className="text-neutral-600">
          Step 5 needs real Clerk keys for browser sign-in. Add{" "}
          <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and{" "}
          <code>CLERK_SECRET_KEY</code> to <code>.env.local</code> (from{" "}
          <a
            className="underline"
            href="https://dashboard.clerk.com"
            target="_blank"
            rel="noreferrer"
          >
            dashboard.clerk.com
          </a>
          ), restart the dev server, then open{" "}
          <Link href="/sign-in" className="underline">
            /sign-in
          </Link>
          .
        </p>
      </main>
    );
  }

  const session = await auth();
  if (session.userId) {
    redirect("/sessions");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Multiplayer AI</h1>
      <p className="text-neutral-600">
        Shared AI work sessions for your team.
      </p>
      <Show when="signed-out">
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white"
          >
            Sign in
          </Link>
          <SignInButton mode="modal" forceRedirectUrl="/sessions">
            <button
              type="button"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm"
            >
              Sign in (modal)
            </button>
          </SignInButton>
        </div>
      </Show>
      <Show when="signed-in">
        <div className="flex items-center gap-3">
          <Link href="/sessions" className="text-sm underline">
            Go to sessions
          </Link>
          <UserButton />
        </div>
      </Show>
    </main>
  );
}
